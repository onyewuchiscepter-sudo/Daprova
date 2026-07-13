import { Kysely, sql } from 'kysely';

// Sprint 1 of docs/org-onboarding-spec.md — splits identity (a person, one
// Firebase login) from org membership (which org(s) they belong to, and
// their role in each), so a person can belong to more than one org.
//
// `people.id` deliberately reuses each row's existing `users.id` value, so
// every existing FK that pointed at users.id (refresh_tokens.user_id,
// competency_frameworks.created_by, cohorts.created_by,
// cohort_reports.generated_by) stays valid data-wise — only the constraint
// target needs repointing to people(id), not the stored values themselves.
//
// refresh_tokens also gains an org_id column: a refresh token used to be
// scoped to a single org implicitly (via users.org_id), but since a person
// can now belong to more than one org, the token itself has to remember
// which org_membership the session was issued for.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('people')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('email', 'varchar(255)', (c) => c.notNull().unique())
    .addColumn('display_name', 'varchar(255)')
    .addColumn('auth_provider', 'varchar(50)', (c) => c.notNull().defaultTo('firebase'))
    .addColumn('auth_uid', 'varchar(255)', (c) => c.notNull().unique())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('last_login_at', 'timestamptz')
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  await db.schema
    .createTable('org_memberships')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('person_id', 'uuid', (c) => c.notNull().references('people.id'))
    .addColumn('org_id', 'uuid', (c) => c.notNull().references('organisations.id'))
    .addColumn('role', 'varchar(50)', (c) => c.notNull().defaultTo('admin'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('deleted_at', 'timestamptz')
    .addCheckConstraint('org_memberships_role_check', sql`role IN ('admin', 'viewer')`)
    .addUniqueConstraint('org_memberships_person_org_unique', ['person_id', 'org_id'])
    .execute();

  await sql`
    INSERT INTO people (id, email, display_name, auth_provider, auth_uid, created_at, last_login_at, deleted_at)
    SELECT id, email, display_name, auth_provider, auth_uid, created_at, last_login_at, deleted_at FROM users
  `.execute(db);

  await sql`
    INSERT INTO org_memberships (person_id, org_id, role, created_at, deleted_at)
    SELECT id, org_id, role, created_at, deleted_at FROM users
  `.execute(db);

  // Backfill refresh_tokens.org_id from the still-existing users table
  // before it's dropped below.
  await db.schema.alterTable('refresh_tokens').addColumn('org_id', 'uuid').execute();
  await sql`UPDATE refresh_tokens SET org_id = users.org_id FROM users WHERE users.id = refresh_tokens.user_id`.execute(db);
  await db.schema.alterTable('refresh_tokens').alterColumn('org_id', (ac) => ac.setNotNull()).execute();
  await sql`ALTER TABLE refresh_tokens ADD CONSTRAINT refresh_tokens_org_id_fkey FOREIGN KEY (org_id) REFERENCES organisations(id)`.execute(db);

  // Repoint every FK that referenced users(id) to people(id) — Postgres's
  // default constraint-naming convention (<table>_<column>_fkey) is what
  // Kysely itself generated for these when 0001_init created them.
  await sql`ALTER TABLE refresh_tokens DROP CONSTRAINT refresh_tokens_user_id_fkey`.execute(db);
  await sql`ALTER TABLE refresh_tokens RENAME COLUMN user_id TO person_id`.execute(db);
  await sql`ALTER TABLE refresh_tokens ADD CONSTRAINT refresh_tokens_person_id_fkey FOREIGN KEY (person_id) REFERENCES people(id)`.execute(db);

  await sql`ALTER TABLE competency_frameworks DROP CONSTRAINT competency_frameworks_created_by_fkey`.execute(db);
  await sql`ALTER TABLE competency_frameworks ADD CONSTRAINT competency_frameworks_created_by_fkey FOREIGN KEY (created_by) REFERENCES people(id)`.execute(db);

  await sql`ALTER TABLE cohorts DROP CONSTRAINT cohorts_created_by_fkey`.execute(db);
  await sql`ALTER TABLE cohorts ADD CONSTRAINT cohorts_created_by_fkey FOREIGN KEY (created_by) REFERENCES people(id)`.execute(db);

  await sql`ALTER TABLE cohort_reports DROP CONSTRAINT cohort_reports_generated_by_fkey`.execute(db);
  await sql`ALTER TABLE cohort_reports ADD CONSTRAINT cohort_reports_generated_by_fkey FOREIGN KEY (generated_by) REFERENCES people(id)`.execute(db);

  await db.schema.dropTable('users').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('org_id', 'uuid', (c) => c.notNull().references('organisations.id'))
    .addColumn('email', 'varchar(255)', (c) => c.notNull().unique())
    .addColumn('display_name', 'varchar(255)')
    .addColumn('role', 'varchar(50)', (c) => c.notNull().defaultTo('admin'))
    .addColumn('auth_provider', 'varchar(50)', (c) => c.notNull().defaultTo('firebase'))
    .addColumn('auth_uid', 'varchar(255)', (c) => c.notNull().unique())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('last_login_at', 'timestamptz')
    .addColumn('deleted_at', 'timestamptz')
    .addCheckConstraint('users_role_check', sql`role IN ('admin', 'viewer')`)
    .execute();

  await sql`
    INSERT INTO users (id, org_id, email, display_name, role, auth_provider, auth_uid, created_at, last_login_at, deleted_at)
    SELECT p.id, m.org_id, p.email, p.display_name, m.role, p.auth_provider, p.auth_uid, p.created_at, p.last_login_at, p.deleted_at
    FROM people p
    INNER JOIN org_memberships m ON m.person_id = p.id
  `.execute(db);

  await sql`ALTER TABLE refresh_tokens DROP CONSTRAINT refresh_tokens_person_id_fkey`.execute(db);
  await sql`ALTER TABLE refresh_tokens RENAME COLUMN person_id TO user_id`.execute(db);
  await sql`ALTER TABLE refresh_tokens ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id)`.execute(db);
  await sql`ALTER TABLE refresh_tokens DROP CONSTRAINT refresh_tokens_org_id_fkey`.execute(db);
  await db.schema.alterTable('refresh_tokens').dropColumn('org_id').execute();

  await sql`ALTER TABLE competency_frameworks DROP CONSTRAINT competency_frameworks_created_by_fkey`.execute(db);
  await sql`ALTER TABLE competency_frameworks ADD CONSTRAINT competency_frameworks_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id)`.execute(db);

  await sql`ALTER TABLE cohorts DROP CONSTRAINT cohorts_created_by_fkey`.execute(db);
  await sql`ALTER TABLE cohorts ADD CONSTRAINT cohorts_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id)`.execute(db);

  await sql`ALTER TABLE cohort_reports DROP CONSTRAINT cohort_reports_generated_by_fkey`.execute(db);
  await sql`ALTER TABLE cohort_reports ADD CONSTRAINT cohort_reports_generated_by_fkey FOREIGN KEY (generated_by) REFERENCES users(id)`.execute(db);

  await db.schema.dropTable('org_memberships').execute();
  await db.schema.dropTable('people').execute();
}
