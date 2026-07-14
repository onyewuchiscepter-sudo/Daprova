import { db } from '../db/index.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { fromCsv } from '../lib/csv.js';

async function assertFrameworkOwnership(orgId: string, frameworkId: string) {
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

async function assertNotLocked(framework: { is_locked: boolean }) {
  // FR-M1-05: framework structure (areas/questions) is immutable once locked.
  if (framework.is_locked) throw conflict('Framework is locked and can no longer be edited — clone it to make changes');
}

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
      const areas = await db
        .selectFrom('competency_areas')
        .select(['id'])
        .where('framework_id', '=', t.id)
        .where('is_active', '=', true)
        .execute();
      return { id: t.id, name: t.name, category: t.category, area_count: areas.length };
    }),
  );
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

async function fullFrameworkPayload(frameworkId: string) {
  const areas = await db
    .selectFrom('competency_areas')
    .selectAll()
    .where('framework_id', '=', frameworkId)
    .orderBy('display_order')
    .execute();

  const areasWithQuestions = await Promise.all(
    areas.map(async (area) => {
      const questions = await db
        .selectFrom('questions')
        .selectAll()
        .where('area_id', '=', area.id)
        .orderBy('created_at')
        .execute();
      const activeCount = questions.filter((q) => q.is_active).length;
      return { ...area, questions, active_question_warning: activeCount < 8 };
    }),
  );

  return areasWithQuestions;
}

export async function getFrameworkDetail(orgId: string, frameworkId: string) {
  const framework = await assertFrameworkOwnership(orgId, frameworkId);
  const areas = await fullFrameworkPayload(frameworkId);
  return { ...framework, areas };
}

async function cloneAreasAndQuestions(sourceFrameworkId: string, targetFrameworkId: string) {
  const areas = await db.selectFrom('competency_areas').selectAll().where('framework_id', '=', sourceFrameworkId).execute();
  for (const area of areas) {
    const newArea = await db
      .insertInto('competency_areas')
      .values({
        framework_id: targetFrameworkId,
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
          })),
        )
        .execute();
    }
  }
}

export async function createFramework(
  orgId: string,
  userId: string,
  opts: { templateId?: string; name: string; category: string },
) {
  if (opts.templateId) {
    const template = await db
      .selectFrom('competency_frameworks')
      .selectAll()
      .where('id', '=', opts.templateId)
      .where('is_template', '=', true)
      .executeTakeFirst();
    if (!template) throw notFound('Template not found');

    const framework = await db
      .insertInto('competency_frameworks')
      .values({ org_id: orgId, name: opts.name, category: template.category, created_by: userId })
      .returningAll()
      .executeTakeFirstOrThrow();

    await cloneAreasAndQuestions(template.id, framework.id);
    return framework;
  }

  if (!opts.category) throw badRequest('category is required when creating a framework from scratch');
  return db
    .insertInto('competency_frameworks')
    .values({ org_id: orgId, name: opts.name, category: opts.category, created_by: userId })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function cloneFramework(orgId: string, userId: string, frameworkId: string, newName?: string) {
  const source = await assertFrameworkOwnership(orgId, frameworkId);
  const cloned = await db
    .insertInto('competency_frameworks')
    .values({
      org_id: orgId,
      name: newName ?? `${source.name} (copy)`,
      category: source.category,
      version: source.version + 1,
      created_by: userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await cloneAreasAndQuestions(source.id, cloned.id);
  return cloned;
}

export async function updateFrameworkName(orgId: string, frameworkId: string, name: string) {
  await assertFrameworkOwnership(orgId, frameworkId);
  return db.updateTable('competency_frameworks').set({ name }).where('id', '=', frameworkId).returningAll().executeTakeFirstOrThrow();
}

export async function addArea(orgId: string, frameworkId: string, opts: { name: string; description?: string }) {
  const framework = await assertFrameworkOwnership(orgId, frameworkId);
  await assertNotLocked(framework);

  const maxOrder = await db
    .selectFrom('competency_areas')
    .select(({ fn }) => fn.max('display_order').as('max_order'))
    .where('framework_id', '=', frameworkId)
    .executeTakeFirst();

  return db
    .insertInto('competency_areas')
    .values({ framework_id: frameworkId, name: opts.name, description: opts.description ?? null, display_order: (maxOrder?.max_order ?? -1) + 1 })
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function assertAreaOwnership(frameworkId: string, areaId: string) {
  const area = await db
    .selectFrom('competency_areas')
    .selectAll()
    .where('id', '=', areaId)
    .where('framework_id', '=', frameworkId)
    .executeTakeFirst();
  if (!area) throw notFound('Competency area not found');
  return area;
}

export async function updateArea(
  orgId: string,
  frameworkId: string,
  areaId: string,
  opts: { name?: string; display_order?: number },
) {
  const framework = await assertFrameworkOwnership(orgId, frameworkId);
  await assertNotLocked(framework);
  await assertAreaOwnership(frameworkId, areaId);

  return db
    .updateTable('competency_areas')
    .set({ ...(opts.name !== undefined && { name: opts.name }), ...(opts.display_order !== undefined && { display_order: opts.display_order }) })
    .where('id', '=', areaId)
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function deactivateArea(orgId: string, frameworkId: string, areaId: string) {
  const framework = await assertFrameworkOwnership(orgId, frameworkId);
  await assertNotLocked(framework);
  await assertAreaOwnership(frameworkId, areaId);

  // US-02: minimum 1 active competency area enforced.
  const activeAreas = await db
    .selectFrom('competency_areas')
    .select(['id'])
    .where('framework_id', '=', frameworkId)
    .where('is_active', '=', true)
    .execute();
  if (activeAreas.length <= 1 && activeAreas.some((a) => a.id === areaId)) {
    throw conflict('Cannot deactivate the only remaining active competency area');
  }

  return db.updateTable('competency_areas').set({ is_active: false }).where('id', '=', areaId).returningAll().executeTakeFirstOrThrow();
}

export type QuestionOption = 'a' | 'b' | 'c' | 'd';
export type QuestionAssessmentType = 'pre' | 'post' | 'both';

export async function createQuestion(
  orgId: string,
  frameworkId: string,
  areaId: string,
  opts: {
    question_text: string;
    option_a: string;
    option_b: string;
    option_c: string;
    option_d: string;
    correct_option: QuestionOption;
    assessment_type?: QuestionAssessmentType;
  },
) {
  const framework = await assertFrameworkOwnership(orgId, frameworkId);
  await assertNotLocked(framework);
  await assertAreaOwnership(frameworkId, areaId);

  return db
    .insertInto('questions')
    .values({
      area_id: areaId,
      question_text: opts.question_text,
      option_a: opts.option_a,
      option_b: opts.option_b,
      option_c: opts.option_c,
      option_d: opts.option_d,
      correct_option: opts.correct_option,
      assessment_type: opts.assessment_type ?? 'both',
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

const REQUIRED_CSV_COLUMNS = ['question_text', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_option'] as const;

type ParsedQuestion = {
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: QuestionOption;
  assessment_type: QuestionAssessmentType;
};

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

    const question_text = row[colIndex('question_text')]?.trim();
    const option_a = row[colIndex('option_a')]?.trim();
    const option_b = row[colIndex('option_b')]?.trim();
    const option_c = row[colIndex('option_c')]?.trim();
    const option_d = row[colIndex('option_d')]?.trim();
    const correctRaw = row[colIndex('correct_option')]?.trim().toLowerCase();
    const assessmentRaw = assessmentTypeCol !== -1 ? row[assessmentTypeCol]?.trim().toLowerCase() : 'both';

    const rowErrors: string[] = [];
    if (!question_text) rowErrors.push('question_text is required');
    if (!option_a) rowErrors.push('option_a is required');
    if (!option_b) rowErrors.push('option_b is required');
    if (!option_c) rowErrors.push('option_c is required');
    if (!option_d) rowErrors.push('option_d is required');
    if (!correctRaw || !['a', 'b', 'c', 'd'].includes(correctRaw)) rowErrors.push('correct_option must be a, b, c, or d');
    if (assessmentRaw && !['pre', 'post', 'both'].includes(assessmentRaw)) rowErrors.push('assessment_type must be pre, post, or both');

    if (rowErrors.length > 0) {
      errors.push(`Row ${rowNum}: ${rowErrors.join('; ')}`);
      continue;
    }

    questions.push({
      question_text: question_text!,
      option_a: option_a!,
      option_b: option_b!,
      option_c: option_c!,
      option_d: option_d!,
      correct_option: correctRaw as QuestionOption,
      assessment_type: (assessmentRaw || 'both') as QuestionAssessmentType,
    });
  }

  return { questions, errors };
}

export async function bulkCreateQuestions(orgId: string, frameworkId: string, areaId: string, csvText: string) {
  const framework = await assertFrameworkOwnership(orgId, frameworkId);
  await assertNotLocked(framework);
  await assertAreaOwnership(frameworkId, areaId);

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
// not just is_active, since a locked framework's questions must match
// whatever a learner already answered against.
export async function updateQuestion(
  orgId: string,
  frameworkId: string,
  questionId: string,
  opts: {
    question_text?: string;
    option_a?: string;
    option_b?: string;
    option_c?: string;
    option_d?: string;
    correct_option?: QuestionOption;
    assessment_type?: QuestionAssessmentType;
    is_active?: boolean;
  },
) {
  const framework = await assertFrameworkOwnership(orgId, frameworkId);
  await assertNotLocked(framework);

  const question = await db
    .selectFrom('questions')
    .innerJoin('competency_areas', 'competency_areas.id', 'questions.area_id')
    .selectAll('questions')
    .where('questions.id', '=', questionId)
    .where('competency_areas.framework_id', '=', frameworkId)
    .executeTakeFirst();
  if (!question) throw notFound('Question not found');

  const patch = {
    ...(opts.question_text !== undefined && { question_text: opts.question_text }),
    ...(opts.option_a !== undefined && { option_a: opts.option_a }),
    ...(opts.option_b !== undefined && { option_b: opts.option_b }),
    ...(opts.option_c !== undefined && { option_c: opts.option_c }),
    ...(opts.option_d !== undefined && { option_d: opts.option_d }),
    ...(opts.correct_option !== undefined && { correct_option: opts.correct_option }),
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

// Called internally when a cohort's first pre-assessment session starts (S3) —
// not exposed as an admin-facing HTTP route since nothing but that internal
// trigger should ever call it (spec marks it Auth: System).
export async function lockFrameworkIfNeeded(frameworkId: string) {
  await db.updateTable('competency_frameworks').set({ is_locked: true }).where('id', '=', frameworkId).where('is_locked', '=', false).execute();
}
