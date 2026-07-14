import { Kysely, sql } from 'kysely';

// Sprint 6 of docs/org-onboarding-spec.md §4.6/§5.6 — the payments table
// plus the columns needed to actually drive the upgrade-and-pay flow
// (reference for provider correlation, target_tier so a webhook/
// reconciliation hit knows which tier to apply without re-deriving it).
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('payments')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('org_id', 'uuid', (c) => c.notNull().references('organisations.id'))
    .addColumn('cohort_id', 'uuid', (c) => c.notNull().references('cohorts.id'))
    .addColumn('amount', 'numeric', (c) => c.notNull())
    .addColumn('status', 'varchar(50)', (c) => c.notNull().defaultTo('pending'))
    .addColumn('provider', 'varchar(50)', (c) => c.notNull())
    .addColumn('reference', 'varchar(100)', (c) => c.notNull().unique())
    .addColumn('target_tier', 'varchar(50)', (c) => c.notNull())
    .addColumn('paid_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('payments').execute();
}
