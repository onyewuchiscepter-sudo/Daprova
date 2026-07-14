import { Kysely, sql } from 'kysely';

// Sprint 5 of docs/org-onboarding-spec.md §1, §4.8, §7.2 — self-serve
// signup (Model A) field set plus the fraud-review queue's backing table.
// All new organisations/people columns are nullable: Model B org creation
// (platformService.createOrgWithAdmin) and the original /api/v1/bootstrap
// endpoint don't collect any of this, and shouldn't be forced to.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('organisations')
    .addColumn('org_type', 'varchar(50)')
    .addColumn('cac_registration_number', 'varchar(50)')
    .addColumn('website_url', 'varchar(255)')
    .addColumn('address', 'varchar(255)')
    .addColumn('primary_use_case', 'varchar(100)')
    .addColumn('expected_cadence', 'varchar(50)')
    .addColumn('reports_to_funder', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('reports_to_funder_name', 'varchar(255)')
    .addColumn('referral_source', 'varchar(100)')
    .execute();

  await db.schema
    .alterTable('people')
    .addColumn('phone', 'varchar(30)')
    .addColumn('title', 'varchar(100)')
    .execute();

  await db.schema
    .createTable('signup_fraud_flags')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('org_id', 'uuid', (c) => c.notNull().references('organisations.id'))
    .addColumn('matched_org_id', 'uuid', (c) => c.notNull().references('organisations.id'))
    .addColumn('match_reason', 'varchar(100)', (c) => c.notNull())
    .addColumn('reviewed_at', 'timestamptz')
    .addColumn('reviewed_by', 'uuid', (c) => c.references('people.id'))
    .addColumn('decision', 'varchar(50)')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('signup_fraud_flags').execute();

  await db.schema.alterTable('people').dropColumn('phone').dropColumn('title').execute();

  await db.schema
    .alterTable('organisations')
    .dropColumn('org_type')
    .dropColumn('cac_registration_number')
    .dropColumn('website_url')
    .dropColumn('address')
    .dropColumn('primary_use_case')
    .dropColumn('expected_cadence')
    .dropColumn('reports_to_funder')
    .dropColumn('reports_to_funder_name')
    .dropColumn('referral_source')
    .execute();
}
