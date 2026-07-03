import { db } from '../index.js';
import { TEMPLATES } from './templateData.js';

// Templates are stored as ordinary competency_frameworks rows (is_template=true),
// owned by a hidden "system templates" organisation rather than any real
// customer org, so POST /frameworks can clone them the same way it would clone
// any other framework. is_locked=true on templates themselves — they're the
// master copies, never edited directly, only cloned into a real org.
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
      .values({ org_id: systemOrg.id, name: template.name, category: template.category, is_template: true, is_locked: true })
      .returningAll()
      .executeTakeFirstOrThrow();

    for (const [areaIndex, area] of template.areas.entries()) {
      const areaRow = await db
        .insertInto('competency_areas')
        .values({ framework_id: framework.id, name: area.name, display_order: areaIndex })
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
