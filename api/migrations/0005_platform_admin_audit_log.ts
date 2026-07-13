import { Kysely, sql } from 'kysely';

// Sprint 2 of docs/org-onboarding-spec.md §4.9/§4.11 — the Daprova-side
// control plane. platform_admins is deliberately separate from
// org_memberships: platform staff status is a property of the *person*,
// not scoped to any one org (§7.1) — a platform admin can simultaneously
// be a regular admin/viewer of their own org, or belong to none at all.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('platform_admins')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('person_id', 'uuid', (c) => c.notNull().unique().references('people.id'))
    .addColumn('platform_role', 'varchar(50)', (c) => c.notNull())
    .addColumn('granted_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('granted_by', 'uuid', (c) => c.references('people.id'))
    .addCheckConstraint('platform_admins_role_check', sql`platform_role IN ('support', 'owner')`)
    .execute();

  // Single audit table for both ordinary org-admin actions (invites, role
  // changes) and platform-admin actions (org creation, suspension,
  // impersonation) — one system to query for "who did what, when, why"
  // instead of two (§7.4).
  await db.schema
    .createTable('audit_log')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('actor_person_id', 'uuid', (c) => c.references('people.id'))
    .addColumn('actor_context', 'varchar(50)', (c) => c.notNull())
    .addColumn('org_id', 'uuid', (c) => c.references('organisations.id'))
    .addColumn('action', 'varchar(100)', (c) => c.notNull())
    .addColumn('details', 'jsonb')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('audit_log').execute();
  await db.schema.dropTable('platform_admins').execute();
}
