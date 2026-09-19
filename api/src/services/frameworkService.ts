import { db } from '../db/index.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { fromCsv } from '../lib/csv.js';

// ---------- Framework-level (top-level container, holds Courses) ----------

export async function assertFrameworkOwnership(orgId: string, frameworkId: string) {
  const framework = await db
    .selectFrom('competency_frameworks')
    .selectAll()
    .where('id', '=', frameworkId)
    .where('org_id', '=', orgId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!framework) throw notFound('Framework not found');
  return framework;
}

// Templates are ordinary frameworks (is_template=true) holding one or more
// template courses, seeded together — see db/seed/frameworks.ts. A
// single-course template clones into a new course with a caller-chosen name
// (cloneTemplateForNewCourse, used by "New Course" -> "From a template"); a
// multi-course template imports its whole framework + every course at once
// (importTemplateFramework, used by the "Import a framework template" flow).
export async function listTemplates() {
  const templates = await db
    .selectFrom('competency_frameworks')
    .selectAll()
    .where('is_template', '=', true)
    .where('deleted_at', 'is', null)
    .orderBy('name')
    .execute();

  return Promise.all(
    templates.map(async (t) => {
      const templateCourses = await db.selectFrom('courses').select(['id']).where('framework_id', '=', t.id).where('is_template', '=', true).execute();
      let areaCount = 0;
      for (const c of templateCourses) {
        const areas = await db.selectFrom('competency_areas').select(['id']).where('course_id', '=', c.id).where('is_active', '=', true).execute();
        areaCount += areas.length;
      }
      return { id: t.id, name: t.name, category: t.category, course_count: templateCourses.length, area_count: areaCount };
    }),
  );
}

// Clones an entire template framework and every one of its template
// courses (each keeping its own name) into a brand-new, org-owned
// framework — for templates that represent a whole curriculum (many
// courses) rather than a single course.
export async function importTemplateFramework(orgId: string, userId: string, templateId: string) {
  const templateFramework = await db
    .selectFrom('competency_frameworks')
    .selectAll()
    .where('id', '=', templateId)
    .where('is_template', '=', true)
    .executeTakeFirst();
  if (!templateFramework) throw notFound('Template not found');

  const templateCourses = await db
    .selectFrom('courses')
    .selectAll()
    .where('framework_id', '=', templateFramework.id)
    .where('is_template', '=', true)
    .orderBy('created_at')
    .execute();
  if (templateCourses.length === 0) throw notFound('Template has no courses');

  const framework = await db
    .insertInto('competency_frameworks')
    .values({ org_id: orgId, name: templateFramework.name, category: templateFramework.category, created_by: userId })
    .returningAll()
    .executeTakeFirstOrThrow();

  const courses = [];
  for (const templateCourse of templateCourses) {
    const course = await db
      .insertInto('courses')
      .values({ org_id: orgId, framework_id: framework.id, name: templateCourse.name, category: templateCourse.category })
      .returningAll()
      .executeTakeFirstOrThrow();
    await cloneAreasAndQuestions(templateCourse.id, course.id);
    courses.push(course);
  }

  return { ...framework, courses };
}

export async function listFrameworks(orgId: string) {
  return db
    .selectFrom('competency_frameworks')
    .selectAll()
    .where('org_id', '=', orgId)
    .where('is_template', '=', false)
    .where('deleted_at', 'is', null)
    .orderBy('created_at', 'desc')
    .execute();
}

// A framework can hold several courses (e.g. "Digital Skills" framework with
// separate Beginner/Advanced courses) — the detail view is the framework's
// name/category plus the list of courses under it, not areas directly
// (those live one level down, on each course).
export async function getFrameworkDetail(orgId: string, frameworkId: string) {
  const framework = await assertFrameworkOwnership(orgId, frameworkId);
  const courses = await db
    .selectFrom('courses')
    .selectAll()
    .where('framework_id', '=', frameworkId)
    .where('deleted_at', 'is', null)
    .orderBy('created_at')
    .execute();
  return { ...framework, courses };
}

export async function updateFrameworkName(orgId: string, frameworkId: string, name: string) {
  await assertFrameworkOwnership(orgId, frameworkId);
  return db.updateTable('competency_frameworks').set({ name }).where('id', '=', frameworkId).returningAll().executeTakeFirstOrThrow();
}

// A framework that still has courses under it can't be deleted outright —
// deleting it would silently orphan those courses (they'd keep working, but
// the framework grouping them would vanish from every list). The admin has
// to delete/move those courses first, same reasoning as "can't deactivate
// the last active area."
export async function deleteFramework(orgId: string, frameworkId: string) {
  await assertFrameworkOwnership(orgId, frameworkId);
  const activeCourses = await db.selectFrom('courses').select('id').where('framework_id', '=', frameworkId).where('deleted_at', 'is', null).execute();
  if (activeCourses.length > 0) {
    throw conflict('Cannot delete a framework that still has courses — delete or move them first');
  }
  await db.updateTable('competency_frameworks').set({ deleted_at: new Date() }).where('id', '=', frameworkId).execute();
}

// ---------- Course-level ownership + locking ----------

export async function assertCourseOwnership(orgId: string, courseId: string) {
  const course = await db
    .selectFrom('courses')
    .selectAll()
    .where('id', '=', courseId)
    .where('org_id', '=', orgId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!course) throw notFound('Course not found');
  return course;
}

async function assertNotLocked(course: { is_locked: boolean }) {
  // FR-M1-05: a course's structure (areas/questions) is immutable once
  // locked — locking moved here from framework-level since areas now belong
  // to a course, not the framework directly.
  if (course.is_locked) throw conflict('Course is locked and can no longer be edited — clone it to make changes');
}

// Called internally when a cohort's first pre-assessment session starts (S3) —
// not exposed as an admin-facing HTTP route since nothing but that internal
// trigger should ever call it (spec marks it Auth: System).
export async function lockCourseIfNeeded(courseId: string) {
  await db.updateTable('courses').set({ is_locked: true }).where('id', '=', courseId).where('is_locked', '=', false).execute();
}

// Renaming a course is allowed even when locked — it doesn't touch
// areas/questions, so FR-M1-05's immutability guarantee isn't affected.
export async function updateCourse(orgId: string, courseId: string, opts: { name: string }) {
  await assertCourseOwnership(orgId, courseId);
  return db.updateTable('courses').set({ name: opts.name }).where('id', '=', courseId).returningAll().executeTakeFirstOrThrow();
}

// Soft delete, same pattern used throughout (organisations, cohorts, etc.) —
// existing cohorts under this course keep working exactly as they do for a
// closed org (historical data untouched), the course just stops appearing
// in lists. No lock/cohort-activity check: archiving a course you're done
// with is a normal action, not one that needs guarding.
export async function deleteCourse(orgId: string, courseId: string) {
  await assertCourseOwnership(orgId, courseId);
  await db.updateTable('courses').set({ deleted_at: new Date() }).where('id', '=', courseId).execute();
}

// A course's areas/questions plus its parent framework's name/category, in
// one payload — mirrors the single-fetch shape the admin UI's course editor
// relies on (previously framework-centric, now course-centric).
export async function getCourseWithAreas(orgId: string, courseId: string) {
  const course = await assertCourseOwnership(orgId, courseId);
  const framework = await db.selectFrom('competency_frameworks').selectAll().where('id', '=', course.framework_id).executeTakeFirstOrThrow();

  const areas = await db.selectFrom('competency_areas').selectAll().where('course_id', '=', courseId).orderBy('display_order').execute();
  const areasWithQuestions = await Promise.all(
    areas.map(async (area) => {
      const questions = await db.selectFrom('questions').selectAll().where('area_id', '=', area.id).orderBy('created_at').execute();
      const activeCount = questions.filter((q) => q.is_active).length;
      return { ...area, questions, active_question_warning: activeCount < 8 };
    }),
  );

  return { ...course, framework: { id: framework.id, name: framework.name, category: framework.category }, areas: areasWithQuestions };
}

async function cloneAreasAndQuestions(sourceCourseId: string, targetCourseId: string) {
  const areas = await db.selectFrom('competency_areas').selectAll().where('course_id', '=', sourceCourseId).execute();
  for (const area of areas) {
    const newArea = await db
      .insertInto('competency_areas')
      .values({
        course_id: targetCourseId,
        name: area.name,
        description: area.description,
        display_order: area.display_order,
        is_active: area.is_active,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const questions = await db.selectFrom('questions').selectAll().where('area_id', '=', area.id).execute();
    if (questions.length > 0) {
      await db
        .insertInto('questions')
        .values(
          questions.map((q) => ({
            area_id: newArea.id,
            question_text: q.question_text,
            option_a: q.option_a,
            option_b: q.option_b,
            option_c: q.option_c,
            option_d: q.option_d,
            correct_option: q.correct_option,
            assessment_type: q.assessment_type,
            is_active: q.is_active,
            question_type: q.question_type,
            scenario_text: q.scenario_text,
          })),
        )
        .execute();
    }
  }
}

// The primary "create a course" entry point for templates: clones the
// template framework AND its one template course (with areas/questions)
// together as a single unit, so picking a template gives the org a fully
// populated, ready-to-use course in one step.
export async function cloneTemplateForNewCourse(orgId: string, userId: string, templateId: string, courseName: string) {
  const templateFramework = await db
    .selectFrom('competency_frameworks')
    .selectAll()
    .where('id', '=', templateId)
    .where('is_template', '=', true)
    .executeTakeFirst();
  if (!templateFramework) throw notFound('Template not found');

  const templateCourse = await db
    .selectFrom('courses')
    .selectAll()
    .where('framework_id', '=', templateFramework.id)
    .where('is_template', '=', true)
    .executeTakeFirst();
  if (!templateCourse) throw notFound('Template course not found');

  const framework = await db
    .insertInto('competency_frameworks')
    .values({ org_id: orgId, name: courseName, category: templateFramework.category, created_by: userId })
    .returningAll()
    .executeTakeFirstOrThrow();

  const course = await db
    .insertInto('courses')
    .values({ org_id: orgId, framework_id: framework.id, name: courseName, category: templateFramework.category })
    .returningAll()
    .executeTakeFirstOrThrow();

  await cloneAreasAndQuestions(templateCourse.id, course.id);
  return course;
}

// "Add another course to an existing (org-owned) framework" — no cloning,
// starts with zero areas since a framework's courses each own their content
// independently (the agreed trade-off: no sharing areas across courses).
export async function createCourseUnderExistingFramework(orgId: string, frameworkId: string, courseName: string) {
  const framework = await assertFrameworkOwnership(orgId, frameworkId);
  return db
    .insertInto('courses')
    .values({ org_id: orgId, framework_id: framework.id, name: courseName, category: framework.category })
    .returningAll()
    .executeTakeFirstOrThrow();
}

// "Start from scratch" — a brand-new framework (this course is its first)
// plus a brand-new, empty course.
export async function createCourseFromScratch(orgId: string, userId: string, courseName: string, category: string) {
  if (!category) throw badRequest('category is required when starting from scratch');
  const framework = await db
    .insertInto('competency_frameworks')
    .values({ org_id: orgId, name: courseName, category, created_by: userId })
    .returningAll()
    .executeTakeFirstOrThrow();
  return db
    .insertInto('courses')
    .values({ org_id: orgId, framework_id: framework.id, name: courseName, category })
    .returningAll()
    .executeTakeFirstOrThrow();
}

// "Clone to make changes" flow for a locked course (FR-M1-05) — stays under
// the same framework, since it's still fundamentally the same program, just
// a fresh unlocked copy of its content ready for new cohorts.
export async function cloneCourse(orgId: string, courseId: string, newName?: string) {
  const source = await assertCourseOwnership(orgId, courseId);
  const cloned = await db
    .insertInto('courses')
    .values({ org_id: orgId, framework_id: source.framework_id, name: newName ?? `${source.name} (copy)`, category: source.category })
    .returningAll()
    .executeTakeFirstOrThrow();

  await cloneAreasAndQuestions(source.id, cloned.id);
  return cloned;
}

export async function addArea(orgId: string, courseId: string, opts: { name: string; description?: string }) {
  const course = await assertCourseOwnership(orgId, courseId);
  await assertNotLocked(course);

  const maxOrder = await db
    .selectFrom('competency_areas')
    .select(({ fn }) => fn.max('display_order').as('max_order'))
    .where('course_id', '=', courseId)
    .executeTakeFirst();

  return db
    .insertInto('competency_areas')
    .values({ course_id: courseId, name: opts.name, description: opts.description ?? null, display_order: (maxOrder?.max_order ?? -1) + 1 })
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function assertAreaOwnership(courseId: string, areaId: string) {
  const area = await db
    .selectFrom('competency_areas')
    .selectAll()
    .where('id', '=', areaId)
    .where('course_id', '=', courseId)
    .executeTakeFirst();
  if (!area) throw notFound('Competency area not found');
  return area;
}

export async function updateArea(orgId: string, courseId: string, areaId: string, opts: { name?: string; display_order?: number }) {
  const course = await assertCourseOwnership(orgId, courseId);
  await assertNotLocked(course);
  await assertAreaOwnership(courseId, areaId);

  return db
    .updateTable('competency_areas')
    .set({ ...(opts.name !== undefined && { name: opts.name }), ...(opts.display_order !== undefined && { display_order: opts.display_order }) })
    .where('id', '=', areaId)
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function deactivateArea(orgId: string, courseId: string, areaId: string) {
  const course = await assertCourseOwnership(orgId, courseId);
  await assertNotLocked(course);
  await assertAreaOwnership(courseId, areaId);

  // US-02: minimum 1 active competency area enforced.
  const activeAreas = await db
    .selectFrom('competency_areas')
    .select(['id'])
    .where('course_id', '=', courseId)
    .where('is_active', '=', true)
    .execute();
  if (activeAreas.length <= 1 && activeAreas.some((a) => a.id === areaId)) {
    throw conflict('Cannot deactivate the only remaining active competency area');
  }

  return db.updateTable('competency_areas').set({ is_active: false }).where('id', '=', areaId).returningAll().executeTakeFirstOrThrow();
}

export type QuestionOption = 'a' | 'b' | 'c' | 'd';
export type QuestionAssessmentType = 'pre' | 'post' | 'both';
export type QuestionType = 'mcq' | 'true_false' | 'scenario' | 'self_rating';
export const QUESTION_TYPES: QuestionType[] = ['mcq', 'true_false', 'scenario', 'self_rating'];

export type QuestionFields = {
  question_type?: QuestionType;
  question_text: string;
  scenario_text?: string | null;
  option_a?: string | null;
  option_b?: string | null;
  option_c?: string | null;
  option_d?: string | null;
  correct_option?: string | null;
};

// One place that knows each question type's shape, so the create, update,
// CSV and bank-import paths can't drift apart:
// - mcq: four options, one correct (a-d)
// - scenario: a situation to read first, then four options, one correct
// - true_false: two options (default "True"/"False"), correct a or b
// - self_rating: the learner rates themselves 1-5 — no correct answer,
//   never scored (see assessmentService.recordResponses); option_a/option_b
//   hold the labels for the two ends of the scale

// Returns the columns to store, or a list of problems.
type NormalizedQuestion = Required<QuestionFields> & { option_a: string; option_b: string };

export function normalizeQuestion(input: QuestionFields): { value?: NormalizedQuestion; errors: string[] } {
  const type = input.question_type ?? 'mcq';
  const errors: string[] = [];
  const text = input.question_text?.trim();
  if (!text) errors.push('question_text is required');
  if (!QUESTION_TYPES.includes(type)) return { errors: [`question_type must be one of ${QUESTION_TYPES.join(', ')}`] };

  const opt = (v: string | null | undefined) => (v ?? '').trim();
  const correct = opt(input.correct_option).toLowerCase();

  if (type === 'self_rating') {
    if (errors.length) return { errors };
    return {
      value: {
        question_type: type,
        question_text: text!,
        scenario_text: null,
        option_a: opt(input.option_a) || 'Not confident',
        option_b: opt(input.option_b) || 'Very confident',
        option_c: null,
        option_d: null,
        correct_option: null,
      },
      errors,
    };
  }

  if (type === 'true_false') {
    if (!['a', 'b'].includes(correct)) errors.push('correct_option must be a (first option) or b (second option)');
    if (errors.length) return { errors };
    return {
      value: { question_type: type, question_text: text!, scenario_text: null, option_a: opt(input.option_a) || 'True', option_b: opt(input.option_b) || 'False', option_c: null, option_d: null, correct_option: correct },
      errors,
    };
  }

  const scenario = opt(input.scenario_text);
  if (type === 'scenario' && !scenario) errors.push('scenario_text is required for a scenario question');
  for (const k of ['option_a', 'option_b', 'option_c', 'option_d'] as const) if (!opt(input[k])) errors.push(`${k} is required`);
  if (!['a', 'b', 'c', 'd'].includes(correct)) errors.push('correct_option must be a, b, c, or d');
  if (errors.length) return { errors };
  return {
    value: {
      question_type: type,
      question_text: text!,
      scenario_text: type === 'scenario' ? scenario : null,
      option_a: opt(input.option_a),
      option_b: opt(input.option_b),
      option_c: opt(input.option_c),
      option_d: opt(input.option_d),
      correct_option: correct,
    },
    errors,
  };
}

export async function createQuestion(orgId: string, courseId: string, areaId: string, opts: QuestionFields & { assessment_type?: QuestionAssessmentType }) {
  const course = await assertCourseOwnership(orgId, courseId);
  await assertNotLocked(course);
  await assertAreaOwnership(courseId, areaId);

  const { value, errors } = normalizeQuestion(opts);
  if (!value) throw badRequest(errors.join('; '), { errors });

  return db
    .insertInto('questions')
    .values({ area_id: areaId, ...value, assessment_type: opts.assessment_type ?? 'both' })
    .returningAll()
    .executeTakeFirstOrThrow();
}

// question_type (mcq | true_false | scenario | self_rating) and scenario_text
// are optional columns; a missing question_type means mcq.
const REQUIRED_CSV_COLUMNS = ['question_text'] as const;

type ParsedQuestion = NormalizedQuestion & { assessment_type: QuestionAssessmentType };

// All-or-nothing by design: reporting "row 12 has an invalid correct_option"
// and inserting nothing is easier for an admin to fix and re-upload than a
// partially-imported batch they'd have to reconcile by hand.
function parseQuestionsCsv(csvText: string): { questions: ParsedQuestion[]; errors: string[] } {
  const rows = fromCsv(csvText);
  if (rows.length === 0) return { questions: [], errors: ['CSV is empty'] };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const missingColumns = REQUIRED_CSV_COLUMNS.filter((c) => !header.includes(c));
  if (missingColumns.length > 0) return { questions: [], errors: [`Missing required column(s): ${missingColumns.join(', ')}`] };

  const colIndex = (name: string) => header.indexOf(name);
  const assessmentTypeCol = colIndex('assessment_type');

  const errors: string[] = [];
  const questions: ParsedQuestion[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.every((cell) => cell.trim() === '')) continue; // skip blank rows
    const rowNum = r + 1; // 1-indexed, matches what a spreadsheet app shows (header is row 1)

    const cell = (name: string) => (colIndex(name) === -1 ? undefined : row[colIndex(name)]?.trim());
    const assessmentRaw = assessmentTypeCol !== -1 ? row[assessmentTypeCol]?.trim().toLowerCase() : 'both';
    const typeRaw = (cell('question_type') || 'mcq').toLowerCase().replace(/[\s/-]+/g, '_');

    const { value, errors: rowErrors } = normalizeQuestion({
      question_type: typeRaw as QuestionType,
      question_text: cell('question_text') ?? '',
      scenario_text: cell('scenario_text'),
      option_a: cell('option_a'),
      option_b: cell('option_b'),
      option_c: cell('option_c'),
      option_d: cell('option_d'),
      correct_option: cell('correct_option'),
    });
    if (assessmentRaw && !['pre', 'post', 'both'].includes(assessmentRaw)) rowErrors.push('assessment_type must be pre, post, or both');

    if (!value || rowErrors.length > 0) {
      errors.push(`Row ${rowNum}: ${rowErrors.join('; ')}`);
      continue;
    }

    questions.push({ ...value, assessment_type: (assessmentRaw || 'both') as QuestionAssessmentType });
  }

  return { questions, errors };
}

export async function bulkCreateQuestions(orgId: string, courseId: string, areaId: string, csvText: string) {
  const course = await assertCourseOwnership(orgId, courseId);
  await assertNotLocked(course);
  await assertAreaOwnership(courseId, areaId);

  const { questions, errors } = parseQuestionsCsv(csvText);
  if (errors.length > 0) throw badRequest('CSV validation failed — nothing was imported', { errors });
  if (questions.length === 0) throw badRequest('No questions found in CSV');

  await db
    .insertInto('questions')
    .values(questions.map((q) => ({ area_id: areaId, ...q })))
    .execute();

  return { created: questions.length };
}

// Replaces the old is_active-only toggle with a general partial update —
// same immutable-once-locked rule (FR-M1-05) applies to every field here,
// not just is_active, since a locked course's questions must match whatever
// a learner already answered against.
export async function updateQuestion(
  orgId: string,
  courseId: string,
  questionId: string,
  opts: Partial<QuestionFields> & { assessment_type?: QuestionAssessmentType; is_active?: boolean },
) {
  const course = await assertCourseOwnership(orgId, courseId);
  await assertNotLocked(course);

  const question = await db
    .selectFrom('questions')
    .innerJoin('competency_areas', 'competency_areas.id', 'questions.area_id')
    .selectAll('questions')
    .where('questions.id', '=', questionId)
    .where('competency_areas.course_id', '=', courseId)
    .executeTakeFirst();
  if (!question) throw notFound('Question not found');

  // Changing any content field re-validates the question as a whole (e.g.
  // switching to true/false clears options c and d).
  const touchesContent = (['question_type', 'question_text', 'scenario_text', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_option'] as const).some(
    (k) => opts[k] !== undefined,
  );
  let content = {};
  if (touchesContent) {
    const { value, errors } = normalizeQuestion({
      question_type: (opts.question_type ?? question.question_type) as QuestionType,
      question_text: opts.question_text ?? question.question_text,
      scenario_text: opts.scenario_text !== undefined ? opts.scenario_text : question.scenario_text,
      option_a: opts.option_a !== undefined ? opts.option_a : question.option_a,
      option_b: opts.option_b !== undefined ? opts.option_b : question.option_b,
      option_c: opts.option_c !== undefined ? opts.option_c : question.option_c,
      option_d: opts.option_d !== undefined ? opts.option_d : question.option_d,
      correct_option: opts.correct_option !== undefined ? opts.correct_option : question.correct_option,
    });
    if (!value) throw badRequest(errors.join('; '), { errors });
    content = value;
  }
  const patch = {
    ...content,
    ...(opts.assessment_type !== undefined && { assessment_type: opts.assessment_type }),
    ...(opts.is_active !== undefined && { is_active: opts.is_active }),
  };
  if (Object.keys(patch).length > 0) {
    await db.updateTable('questions').set(patch).where('id', '=', questionId).execute();
  }

  // FR-M1-06: warn (don't block) when an area drops below 8 active questions.
  const activeCount = await db
    .selectFrom('questions')
    .select(({ fn }) => fn.countAll().as('count'))
    .where('area_id', '=', question.area_id)
    .where('is_active', '=', true)
    .executeTakeFirstOrThrow();

  return { warning: Number(activeCount.count) < 8 };
}

// ---------------------------------------------------------------------------
// Question bank: search every question the org has already written (across
// all its courses) plus Daprova's template questions, and copy chosen ones
// into an area — so good questions get reused instead of retyped.

export async function searchQuestionBank(orgId: string, opts: { q?: string; type?: string; limit?: number }) {
  let query = db
    .selectFrom('questions as q')
    .innerJoin('competency_areas as a', 'a.id', 'q.area_id')
    .innerJoin('courses as c', 'c.id', 'a.course_id')
    .select([
      'q.id',
      'q.question_type',
      'q.question_text',
      'q.scenario_text',
      'q.option_a',
      'q.option_b',
      'q.option_c',
      'q.option_d',
      'q.correct_option',
      'a.name as area_name',
      'c.name as course_name',
      'c.is_template',
    ])
    .where((eb) => eb.or([eb('c.org_id', '=', orgId), eb('c.is_template', '=', true)]))
    .where('c.deleted_at', 'is', null)
    .where('q.is_active', '=', true);
  const term = opts.q?.trim();
  if (term) query = query.where((eb) => eb.or([eb('q.question_text', 'ilike', `%${term}%`), eb('a.name', 'ilike', `%${term}%`), eb('c.name', 'ilike', `%${term}%`)]));
  if (opts.type && QUESTION_TYPES.includes(opts.type as QuestionType)) query = query.where('q.question_type', '=', opts.type);
  const rows = await query
    .orderBy('c.is_template')
    .orderBy('q.created_at', 'desc')
    .limit(Math.min(opts.limit ?? 50, 100))
    .execute();
  // The same template question appears once per org clone; show it once.
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = `${r.question_type}|${r.question_text}|${r.option_a}|${r.correct_option}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function importQuestionsFromBank(orgId: string, courseId: string, areaId: string, questionIds: string[]) {
  const course = await assertCourseOwnership(orgId, courseId);
  await assertNotLocked(course);
  await assertAreaOwnership(courseId, areaId);
  if (!questionIds.length) throw badRequest('Choose at least one question');

  const source = await db
    .selectFrom('questions as q')
    .innerJoin('competency_areas as a', 'a.id', 'q.area_id')
    .innerJoin('courses as c', 'c.id', 'a.course_id')
    .select(['q.question_type', 'q.question_text', 'q.scenario_text', 'q.option_a', 'q.option_b', 'q.option_c', 'q.option_d', 'q.correct_option', 'q.assessment_type'])
    .where('q.id', 'in', questionIds)
    .where((eb) => eb.or([eb('c.org_id', '=', orgId), eb('c.is_template', '=', true)]))
    .execute();
  if (source.length !== new Set(questionIds).size) throw notFound('Some of those questions were not found');

  await db
    .insertInto('questions')
    .values(source.map((q) => ({ area_id: areaId, ...q })))
    .execute();
  return { imported: source.length };
}
