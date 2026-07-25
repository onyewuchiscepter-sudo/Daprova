import { Kysely } from 'kysely';

// Cleanup follow-up to 0015: is_locked moved to courses (areas/questions now
// belong to a course, not the framework directly), so the original
// competency_frameworks.is_locked column is dead weight — worse, it's
// actively misleading, since it never updates again but still looks live.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('competency_frameworks').dropColumn('is_locked').execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('competency_frameworks').addColumn('is_locked', 'boolean', (c) => c.notNull().defaultTo(false)).execute();
}
