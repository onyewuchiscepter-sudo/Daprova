import { Kysely, sql } from 'kysely';

// Sprint 4 of docs/org-onboarding-spec.md §4.3-§4.7, §5 — the pricing
// engine's schema. Confirmed fixed tiers (§5.2), seeded here rather than
// hardcoded in application code, per the pricing spec's own instruction.
export async function up(db: Kysely<unknown>): Promise<void> {
  // organisations.plan_tier already exists but was never read or written
  // anywhere (confirmed by grep before writing this migration) — rename
  // rather than add a second, redundant column.
  await sql`ALTER TABLE organisations RENAME COLUMN plan_tier TO current_plan_tier`.execute(db);
  await db.schema.alterTable('organisations').alterColumn('current_plan_tier', (ac) => ac.setDefault('ENTRY')).execute();

  await db.schema
    .alterTable('organisations')
    .addColumn('has_used_free_trial', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('billing_status', 'varchar(50)', (c) => c.notNull().defaultTo('active'))
    .addColumn('signup_review_status', 'varchar(50)')
    .execute();

  await db.schema
    .alterTable('cohorts')
    .addColumn('cohort_number', 'integer')
    .addColumn('student_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('is_free_trial', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('plan_tier_at_creation', 'varchar(50)')
    .execute();

  // Backfill cohort_number per org (ordinal by creation date) and
  // student_count from the learners already enrolled, so pre-existing
  // cohorts (the synthetic 245-learner dataset, Acme's seeded cohort) are
  // consistent with the new enforcement logic rather than starting at 0/null.
  await sql`
    UPDATE cohorts SET cohort_number = sub.rn
    FROM (
      SELECT cohorts.id, ROW_NUMBER() OVER (PARTITION BY courses.org_id ORDER BY cohorts.created_at) as rn
      FROM cohorts
      INNER JOIN courses ON courses.id = cohorts.course_id
    ) sub
    WHERE cohorts.id = sub.id
  `.execute(db);

  await sql`
    UPDATE cohorts SET student_count = sub.cnt
    FROM (SELECT cohort_id, COUNT(*) as cnt FROM learners GROUP BY cohort_id) sub
    WHERE cohorts.id = sub.cohort_id
  `.execute(db);

  await sql`ALTER TABLE cohorts DROP CONSTRAINT IF EXISTS cohorts_status_check`.execute(db);
  await sql`ALTER TABLE cohorts ADD CONSTRAINT cohorts_status_check CHECK (status IN ('setup','active','graduated','closed','locked_pending_upgrade','pending_manual_quote'))`.execute(
    db,
  );

  await db.schema
    .createTable('plan_tiers')
    .addColumn('tier_id', 'varchar(50)', (c) => c.primaryKey())
    .addColumn('name', 'varchar(100)', (c) => c.notNull())
    .addColumn('min_students', 'integer', (c) => c.notNull())
    .addColumn('max_students', 'integer')
    .addColumn('price', 'numeric')
    .addColumn('features', 'jsonb', (c) => c.notNull())
    .execute();

  const BASE_FEATURES = ['auto_scoring', 'basic_pre_post_comparison'];
  const GROWTH_FEATURES = [...BASE_FEATURES, 'exportable_reports', 'custom_branding'];
  const SCALE_1_FEATURES = [...GROWTH_FEATURES, 'advanced_analytics'];
  const SCALE_2_FEATURES = [...SCALE_1_FEATURES, 'api_integration', 'priority_support'];
  const ENTERPRISE_FEATURES = [...SCALE_2_FEATURES, 'offline_deployment'];

  await db
    .insertInto('plan_tiers')
    .values([
      { tier_id: 'FREE_TRIAL', name: 'Free Trial', min_students: 1, max_students: 50, price: 0, features: JSON.stringify(BASE_FEATURES) },
      { tier_id: 'ENTRY', name: 'Entry', min_students: 1, max_students: 50, price: 20000, features: JSON.stringify(BASE_FEATURES) },
      { tier_id: 'GROWTH', name: 'Growth', min_students: 51, max_students: 100, price: 45000, features: JSON.stringify(GROWTH_FEATURES) },
      { tier_id: 'SCALE_1', name: 'Scale 1', min_students: 101, max_students: 250, price: 100000, features: JSON.stringify(SCALE_1_FEATURES) },
      { tier_id: 'SCALE_2', name: 'Scale 2', min_students: 251, max_students: 1000, price: 250000, features: JSON.stringify(SCALE_2_FEATURES) },
      { tier_id: 'ENTERPRISE', name: 'Enterprise', min_students: 1001, max_students: null, price: null, features: JSON.stringify(ENTERPRISE_FEATURES) },
    ])
    .execute();

  await db.schema
    .createTable('cohort_tier_history')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('cohort_id', 'uuid', (c) => c.notNull().references('cohorts.id'))
    .addColumn('old_tier', 'varchar(50)')
    .addColumn('new_tier', 'varchar(50)', (c) => c.notNull())
    .addColumn('changed_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('payment_id', 'uuid')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('cohort_tier_history').execute();
  await db.schema.dropTable('plan_tiers').execute();

  await sql`ALTER TABLE cohorts DROP CONSTRAINT IF EXISTS cohorts_status_check`.execute(db);
  await sql`ALTER TABLE cohorts ADD CONSTRAINT cohorts_status_check CHECK (status IN ('setup','active','graduated','closed'))`.execute(db);

  await db.schema
    .alterTable('cohorts')
    .dropColumn('cohort_number')
    .dropColumn('student_count')
    .dropColumn('is_free_trial')
    .dropColumn('plan_tier_at_creation')
    .execute();

  await db.schema
    .alterTable('organisations')
    .dropColumn('has_used_free_trial')
    .dropColumn('billing_status')
    .dropColumn('signup_review_status')
    .execute();
  await db.schema.alterTable('organisations').alterColumn('current_plan_tier', (ac) => ac.setDefault('starter')).execute();
  await sql`ALTER TABLE organisations RENAME COLUMN current_plan_tier TO plan_tier`.execute(db);
}
