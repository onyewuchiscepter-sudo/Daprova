import { Kysely, sql } from 'kysely';

// Sprint 3 of docs/org-onboarding-spec.md §4.1 — the invite-a-teammate
// flow the original PRD spec'd (POST /api/v1/org/users/invite) but never
// built.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('invites')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('org_id', 'uuid', (c) => c.notNull().references('organisations.id'))
    .addColumn('email', 'varchar(255)', (c) => c.notNull())
    .addColumn('role', 'varchar(50)', (c) => c.notNull())
    .addColumn('token', 'varchar(255)', (c) => c.notNull().unique())
    .addColumn('invited_by', 'uuid', (c) => c.references('people.id'))
    .addColumn('expires_at', 'timestamptz', (c) => c.notNull())
    .addColumn('accepted_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('invites_role_check', sql`role IN ('admin', 'viewer')`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('invites').execute();
}
