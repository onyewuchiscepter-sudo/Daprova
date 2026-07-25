import { db } from '../index.js';
import { TEMPLATES } from './templateData.js';

// Templates are stored as an ordinary competency_frameworks row
// (is_template=true) holding exactly one ordinary courses row
// (is_template=true), owned by a hidden "system templates" organisation
// rather than any real customer org — picking a template clones both
// together (frameworkService.cloneTemplateForNewCourse). is_locked=true on
// the template course — it's the master copy, never edited directly, only
// cloned into a real org's own course.
const SYSTEM_ORG = { name: 'Daprova System Templates', slug: 'system-templates', contact_email: 'templates@daprova.internal' };

export async function seedFrameworkTemplates() {
  const systemOrg = await db
    .selectFrom('organisations')
    .selectAll()
    .where('slug', '=', SYSTEM_ORG.slug)
    .executeTakeFirst()
    .then((existing) => existing ?? db.insertInto('organisations').values(SYSTEM_ORG).returningAll().executeTakeFirstOrThrow());

  for (const template of TEMPLATES) {
    const existing = await db
      .selectFrom('competency_frameworks')
      .selectAll()
      .where('org_id', '=', systemOrg.id)
      .where('category', '=', template.category)
      .where('is_template', '=', true)
      .executeTakeFirst();
    if (existing) {
      console.log(`[seed] template "${template.name}" already exists, skipping`);
      continue;
    }

    const framework = await db
      .insertInto('competency_frameworks')
      .values({ org_id: systemOrg.id, name: template.name, category: template.category, is_template: true })
      .returningAll()
      .executeTakeFirstOrThrow();

    const templateCourse = await db
      .insertInto('courses')
      .values({ org_id: systemOrg.id, framework_id: framework.id, name: template.name, category: template.category, is_template: true, is_locked: true })
      .returningAll()
      .executeTakeFirstOrThrow();

    for (const [areaIndex, area] of template.areas.entries()) {
      const areaRow = await db
        .insertInto('competency_areas')
        .values({ course_id: templateCourse.id, name: area.name, display_order: areaIndex })
        .returningAll()
        .executeTakeFirstOrThrow();

      await db
        .insertInto('questions')
        .values(
          area.questions.map((q) => ({
            area_id: areaRow.id,
            question_text: q.text,
            option_a: q.a,
            option_b: q.b,
            option_c: q.c,
            option_d: q.d,
            correct_option: q.correct,
            assessment_type: q.type,
          })),
        )
        .execute();
    }

    console.log(`[seed] created template "${template.name}" (${template.areas.length} areas)`);
  }
}

// A multi-course template — the whole "SME Digital & Business Skills"
// curriculum as one importable unit (frameworkService.importTemplateFramework),
// rather than one course at a time. Structure only, deliberately: each
// template course starts with zero competency areas, ready for whoever
// imports it to add areas and bulk-upload questions themselves.
const SME_FRAMEWORK = { name: 'SME Digital & Business Skills', category: 'business_skills' };
const SME_COURSES = [
  'Microsoft Excel',
  'Microsoft Word',
  'Google Tools',
  'Invoicing Tools',
  'Inventory Management Tools',
  'Cloud Storage Tools',
  'Recording Tools',
  'Online Meeting Tools',
  'Retail Management Tools',
  'AI Tools',
  'Project Management Tools',
  'Bookkeeping Tools',
  'Expense Management Tools',
  'Note-Taking Tools',
  'Email Writing Tools',
  'Order Management Tools',
  'Checklist Tools',
  'Classroom Tools',
  'Presentation Tools',
  'Design Tools',
  'CRM Tools',
  'Report Writing',
  'Communication',
  'Work Ethics',
  'Time Management',
  'Negotiation',
  'Reconciliations',
  'Freelancing',
  'Inventory Management',
  'Money Management',
  'Proposal Writing',
  'Mastering Software',
  'Recordkeeping',
  'Supporting SMEs',
];

export async function seedMultiCourseTemplate() {
  const systemOrg = await db
    .selectFrom('organisations')
    .selectAll()
    .where('slug', '=', SYSTEM_ORG.slug)
    .executeTakeFirst()
    .then((existing) => existing ?? db.insertInto('organisations').values(SYSTEM_ORG).returningAll().executeTakeFirstOrThrow());

  const existing = await db
    .selectFrom('competency_frameworks')
    .selectAll()
    .where('org_id', '=', systemOrg.id)
    .where('name', '=', SME_FRAMEWORK.name)
    .where('is_template', '=', true)
    .executeTakeFirst();
  if (existing) {
    console.log(`[seed] template "${SME_FRAMEWORK.name}" already exists, skipping`);
    return;
  }

  const framework = await db
    .insertInto('competency_frameworks')
    .values({ org_id: systemOrg.id, name: SME_FRAMEWORK.name, category: SME_FRAMEWORK.category, is_template: true })
    .returningAll()
    .executeTakeFirstOrThrow();

  await db
    .insertInto('courses')
    .values(
      SME_COURSES.map((name) => ({
        org_id: systemOrg.id,
        framework_id: framework.id,
        name,
        category: SME_FRAMEWORK.category,
        is_template: true,
        is_locked: true,
      })),
    )
    .execute();

  console.log(`[seed] created template "${SME_FRAMEWORK.name}" (${SME_COURSES.length} courses)`);
}
