// Loads only the built-in framework/course templates (the same thing
// POST /api/v1/bootstrap/templates does), against whatever DATABASE_URL
// points at. Safe to re-run: existing templates are skipped.
import { db } from '../index.js';
import { seedFrameworkTemplates, seedMultiCourseTemplate } from './frameworks.js';

async function main() {
  await seedFrameworkTemplates();
  await seedMultiCourseTemplate();
  const rows = await db
    .selectFrom('competency_frameworks')
    .select(['name', 'category'])
    .where('is_template', '=', true)
    .orderBy('created_at')
    .execute();
  console.table(rows);
  await db.destroy();
}

main().catch((err) => {
  console.error('[seed:templates] failed', err);
  process.exit(1);
});
