import { Kysely, sql } from 'kysely';

// Plan lock: a plan set by Daprova staff that the automatic volume-based
// re-evaluation leaves alone — indefinitely, or until tier_locked_until.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('organisations')
    .addColumn('tier_locked', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('tier_locked_until', 'timestamptz')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('organisations').dropColumn('tier_locked_until').dropColumn('tier_locked').execute();
  await sql`select 1`.execute(db);
}
