import { db } from '../db/index.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';

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

export async function patchQuestion(orgId: string, frameworkId: string, questionId: string, isActive: boolean) {
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

  await db.updateTable('questions').set({ is_active: isActive }).where('id', '=', questionId).execute();

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
