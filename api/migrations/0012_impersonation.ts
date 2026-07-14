import { Kysely, sql } from 'kysely';

// Sprint 8 of docs/org-onboarding-spec.md §4.10/§7.3 — impersonation
// sessions. No `deleted_at`/soft-delete pattern here since a row is never
// removed or hidden — `ended_at` (explicit end) and `expires_at` (hard TTL)
// together are the complete lifecycle, and both states stay visible for
// the audit trail this table exists to support.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('impersonation_sessions')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('platform_admin_person_id', 'uuid', (c) => c.notNull().references('people.id'))
    .addColumn('target_org_membership_id', 'uuid', (c) => c.notNull().references('org_memberships.id'))
    .addColumn('reason', 'text', (c) => c.notNull())
    .addColumn('mode', 'varchar(20)', (c) => c.notNull())
    .addColumn('started_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('expires_at', 'timestamptz', (c) => c.notNull())
    .addColumn('ended_at', 'timestamptz')
    .execute();

  await sql`ALTER TABLE impersonation_sessions ADD CONSTRAINT impersonation_sessions_mode_check CHECK (mode IN ('write','read_only'))`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('impersonation_sessions').execute();
}
