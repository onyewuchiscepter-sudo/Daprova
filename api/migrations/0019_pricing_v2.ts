import { Kysely, sql } from 'kysely';

// Pricing & Billing Specification v1.0 (pricing_version "2026-09-v1").
// Replaces per-cohort tiers (0008: plan_tiers, cohorts.plan_tier_at_creation,
// cohort_tier_history, organisations.current_plan_tier/has_used_free_trial)
// with organisation-level tiers set by trailing-12-month learner volume,
// invoices, and an annual funder-report quota. The legacy columns/tables are
// left in place, unused, so historical payments stay intact.
//
// The tier config below is inserted verbatim and must never be edited here
// or in the database: a price change is a new pricing_version (new rows), and
// each organisation stays on the version it signed up under until migrated.

const VERSION = '2026-09-v1';

const TIERS = [
  {
    tier_id: 'starter',
    display_name: 'Starter',
    students_per_year_min: 0,
    students_per_year_max: 250,
    base_fee_monthly_ngn: 25000,
    base_fee_per_cohort_cycle_ngn: 85000,
    assessment_fee_per_learner_ngn: 1000,
    concurrent_cohorts_limit: 1,
    funder_reports_included_per_year: 1,
    additional_report_fee_ngn: 25000,
    features: {
      pre_post_assessment_engine: true,
      learner_satisfaction_survey: true,
      analytics_scores: 'basic',
      learner_certificate: true,
      equity_dashboard: false,
      multi_cohort_trend_comparison: false,
      live_funder_monitoring_link: false,
      tracer_survey: false,
      integrations: ['teachable'],
      support_tier: 'email_selfserve',
    },
  },
  {
    tier_id: 'growth',
    display_name: 'Growth',
    students_per_year_min: 250,
    students_per_year_max: 500,
    base_fee_monthly_ngn: 33000,
    base_fee_per_cohort_cycle_ngn: 112000,
    assessment_fee_per_learner_ngn: 1000,
    concurrent_cohorts_limit: 3,
    funder_reports_included_per_year: 2,
    additional_report_fee_ngn: 18000,
    features: {
      pre_post_assessment_engine: true,
      learner_satisfaction_survey: true,
      analytics_scores: 'full',
      learner_certificate: true,
      equity_dashboard: true,
      multi_cohort_trend_comparison: false,
      live_funder_monitoring_link: 'single_funder_view',
      tracer_survey: true,
      integrations: ['teachable', 'selar', 'google_classroom'],
      support_tier: 'email_plus_onboarding_call',
    },
  },
  {
    tier_id: 'scale',
    display_name: 'Scale',
    students_per_year_min: 500,
    students_per_year_max: 1000,
    base_fee_monthly_ngn: 40000,
    base_fee_per_cohort_cycle_ngn: 135000,
    assessment_fee_per_learner_ngn: 1000,
    concurrent_cohorts_limit: null,
    funder_reports_included_per_year: 4,
    additional_report_fee_ngn: 10000,
    features: {
      pre_post_assessment_engine: true,
      learner_satisfaction_survey: true,
      analytics_scores: 'full',
      learner_certificate: true,
      equity_dashboard: true,
      multi_cohort_trend_comparison: true,
      live_funder_monitoring_link: 'multi_funder_historical',
      tracer_survey: true,
      integrations: ['teachable', 'selar', 'google_classroom', 'custom_lms_api'],
      support_tier: 'priority',
    },
  },
  {
    tier_id: 'enterprise',
    display_name: 'Enterprise',
    students_per_year_min: 1000,
    students_per_year_max: null,
    base_fee_monthly_ngn: null,
    base_fee_per_cohort_cycle_ngn: null,
    assessment_fee_per_learner_ngn: 800,
    concurrent_cohorts_limit: null,
    funder_reports_included_per_year: null,
    additional_report_fee_ngn: null,
    requires_custom_quote: true,
    features: {
      pre_post_assessment_engine: true,
      learner_satisfaction_survey: true,
      analytics_scores: 'custom',
      learner_certificate: true,
      certificate_white_label_option: true,
      equity_dashboard: true,
      multi_cohort_trend_comparison: true,
      live_funder_monitoring_link: 'multi_funder_portfolio_ready',
      tracer_survey: true,
      integrations: ['teachable', 'selar', 'google_classroom', 'custom_lms_api', 'dedicated_integration_support'],
      support_tier: 'dedicated_account_contact',
    },
  },
];

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('pricing_tiers')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('pricing_version', 'varchar(20)', (c) => c.notNull())
    .addColumn('tier_id', 'varchar(20)', (c) => c.notNull())
    .addColumn('config_json', 'jsonb', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('pricing_tiers_version_tier_unique', ['pricing_version', 'tier_id'])
    .execute();
  await db
    .insertInto('pricing_tiers')
    .values(TIERS.map((t) => ({ pricing_version: VERSION, tier_id: t.tier_id, config_json: JSON.stringify(t) })))
    .execute();

  await db.schema
    .alterTable('organisations')
    .addColumn('pricing_tier', 'varchar(20)', (c) => c.notNull().defaultTo('starter'))
    .addColumn('tier_effective_date', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('billing_frequency', 'varchar(20)', (c) => c.notNull().defaultTo('monthly'))
    .addColumn('pricing_version', 'varchar(20)', (c) => c.notNull().defaultTo(VERSION))
    .addColumn('is_enterprise_custom', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('custom_pricing_json', 'jsonb')
    // Self-selected at signup; drives the Enterprise gate until real
    // trailing volume exists.
    .addColumn('projected_students_per_year', 'integer')
    // Free trial = the org's first cohort (assessment fees waived for up to
    // 50 learners, no base fee). Billing starts when that ends.
    .addColumn('free_cohorts_remaining', 'integer', (c) => c.notNull().defaultTo(1))
    .addColumn('billing_started_at', 'timestamptz')
    // Monthly billing: start of the current base-fee period.
    .addColumn('current_period_start', 'timestamptz')
    // A tier the org has moved into by volume, waiting for the next cycle
    // (upgrade) or renewal point (downgrade) to take effect.
    .addColumn('pending_tier', 'varchar(20)')
    .execute();
  await sql`ALTER TABLE organisations ADD CONSTRAINT organisations_pricing_tier_check CHECK (pricing_tier IN ('starter','growth','scale','enterprise'))`.execute(db);
  await sql`ALTER TABLE organisations ADD CONSTRAINT organisations_billing_frequency_check CHECK (billing_frequency IN ('monthly','per_cohort_cycle'))`.execute(db);

  // Existing orgs: the org's earliest cohort is its free-trial cohort; if it
  // has one, the trial is used up and billing has started.
  await sql`UPDATE cohorts SET is_free_trial = false`.execute(db);
  await sql`
    UPDATE cohorts SET is_free_trial = true WHERE id IN (
      SELECT DISTINCT ON (c.org_id) co.id FROM cohorts co JOIN courses c ON c.id = co.course_id
      WHERE co.deleted_at IS NULL ORDER BY c.org_id, co.created_at)`.execute(db);
  await sql`
    UPDATE organisations o SET free_cohorts_remaining = 0
    WHERE EXISTS (SELECT 1 FROM cohorts co JOIN courses c ON c.id = co.course_id WHERE c.org_id = o.id AND co.deleted_at IS NULL)`.execute(db);
  // More than one cohort means the free one is behind them: billing runs from now.
  await sql`
    UPDATE organisations o SET billing_started_at = now(), current_period_start = now()
    WHERE (SELECT count(*) FROM cohorts co JOIN courses c ON c.id = co.course_id WHERE c.org_id = o.id AND co.deleted_at IS NULL) > 1`.execute(db);

  await db.schema
    .alterTable('cohorts')
    // Set when the post-assessment window closes and results are final —
    // the point the cohort's assessment fees are invoiced.
    .addColumn('finalized_at', 'timestamptz')
    .execute();

  await sql`CREATE SEQUENCE invoice_number_seq START 1001`.execute(db);
  await db.schema
    .createTable('invoices')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('invoice_number', 'varchar(30)', (c) => c.notNull().unique())
    .addColumn('org_id', 'uuid', (c) => c.notNull().references('organisations.id'))
    .addColumn('cohort_id', 'uuid', (c) => c.references('cohorts.id'))
    .addColumn('kind', 'varchar(30)', (c) => c.notNull()) // monthly_base | cohort_cycle_base | cohort_completion | report_overage
    .addColumn('tier_id', 'varchar(20)', (c) => c.notNull())
    .addColumn('pricing_version', 'varchar(20)', (c) => c.notNull())
    .addColumn('billing_period_start', 'timestamptz', (c) => c.notNull())
    .addColumn('billing_period_end', 'timestamptz', (c) => c.notNull())
    .addColumn('base_fee_ngn', sql`numeric(12,2)`, (c) => c.notNull().defaultTo(0))
    .addColumn('assessment_fee_ngn', sql`numeric(12,2)`, (c) => c.notNull().defaultTo(0))
    .addColumn('report_fee_ngn', sql`numeric(12,2)`, (c) => c.notNull().defaultTo(0))
    .addColumn('learners_billed_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('reports_billed_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('total_ngn', sql`numeric(12,2)`, (c) => c.notNull())
    .addColumn('line_items', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('status', 'varchar(20)', (c) => c.notNull().defaultTo('pending')) // pending | paid | overdue | void
    .addColumn('due_date', 'timestamptz', (c) => c.notNull())
    .addColumn('paid_at', 'timestamptz')
    .addColumn('notes', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('deleted_at', 'timestamptz')
    .execute();
  await sql`ALTER TABLE invoices ADD CONSTRAINT invoices_status_check CHECK (status IN ('pending','paid','overdue','void'))`.execute(db);
  await db.schema.createIndex('invoices_org_idx').on('invoices').columns(['org_id', 'created_at']).execute();
  // One completion invoice per cohort, one base invoice per period.
  await sql`CREATE UNIQUE INDEX invoices_cohort_completion_unique ON invoices (cohort_id) WHERE kind = 'cohort_completion' AND deleted_at IS NULL`.execute(db);
  await sql`CREATE UNIQUE INDEX invoices_cohort_cycle_unique ON invoices (cohort_id) WHERE kind = 'cohort_cycle_base' AND deleted_at IS NULL`.execute(db);
  await sql`CREATE UNIQUE INDEX invoices_monthly_period_unique ON invoices (org_id, billing_period_start) WHERE kind = 'monthly_base' AND deleted_at IS NULL`.execute(db);

  await db.schema
    .createTable('report_quota_usage')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('org_id', 'uuid', (c) => c.notNull().references('organisations.id'))
    .addColumn('period_start', 'timestamptz', (c) => c.notNull())
    .addColumn('period_end', 'timestamptz', (c) => c.notNull())
    .addColumn('reports_used', 'integer', (c) => c.notNull().defaultTo(0))
    .addUniqueConstraint('report_quota_usage_org_period_unique', ['org_id', 'period_start'])
    .execute();

  // Payments now settle invoices rather than per-cohort upgrades.
  await db.schema.alterTable('payments').addColumn('invoice_id', 'uuid', (c) => c.references('invoices.id')).execute();
  await db.schema.alterTable('payments').alterColumn('cohort_id', (c) => c.dropNotNull()).execute();
  await db.schema.alterTable('payments').alterColumn('target_tier', (c) => c.dropNotNull()).execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('payments').dropColumn('invoice_id').execute();
  await db.schema.dropTable('report_quota_usage').execute();
  await db.schema.dropTable('invoices').execute();
  await sql`DROP SEQUENCE IF EXISTS invoice_number_seq`.execute(db);
  await db.schema.alterTable('cohorts').dropColumn('finalized_at').execute();
  await sql`ALTER TABLE organisations DROP CONSTRAINT IF EXISTS organisations_pricing_tier_check`.execute(db);
  await sql`ALTER TABLE organisations DROP CONSTRAINT IF EXISTS organisations_billing_frequency_check`.execute(db);
  await db.schema
    .alterTable('organisations')
    .dropColumn('pricing_tier')
    .dropColumn('tier_effective_date')
    .dropColumn('billing_frequency')
    .dropColumn('pricing_version')
    .dropColumn('is_enterprise_custom')
    .dropColumn('custom_pricing_json')
    .dropColumn('projected_students_per_year')
    .dropColumn('free_cohorts_remaining')
    .dropColumn('billing_started_at')
    .dropColumn('current_period_start')
    .dropColumn('pending_tier')
    .execute();
  await db.schema.dropTable('pricing_tiers').execute();
}
