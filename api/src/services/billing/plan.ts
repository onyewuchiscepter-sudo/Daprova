import { sql } from 'kysely';
import { db } from '../../db/index.js';
import { AppError, notFound } from '../../lib/errors.js';

// Pricing & Billing Spec §2-§5. Tier configs live in pricing_tiers (seeded by
// migration 0019, never edited in place); each organisation is locked to the
// pricing_version it signed up under. Everything else in billing asks this
// module what an org's plan is.

export type TierId = 'starter' | 'growth' | 'scale' | 'enterprise';
export const TIER_ORDER: TierId[] = ['starter', 'growth', 'scale', 'enterprise'];

export type TierFeatures = {
  pre_post_assessment_engine: boolean;
  learner_satisfaction_survey: boolean;
  analytics_scores: 'basic' | 'full' | 'custom';
  learner_certificate: boolean;
  certificate_white_label_option?: boolean;
  equity_dashboard: boolean;
  multi_cohort_trend_comparison: boolean;
  live_funder_monitoring_link: false | 'single_funder_view' | 'multi_funder_historical' | 'multi_funder_portfolio_ready';
  tracer_survey: boolean;
  integrations: string[];
  support_tier: string;
};

export type TierConfig = {
  tier_id: TierId;
  display_name: string;
  students_per_year_min: number;
  students_per_year_max: number | null;
  base_fee_monthly_ngn: number | null;
  base_fee_per_cohort_cycle_ngn: number | null;
  assessment_fee_per_learner_ngn: number;
  concurrent_cohorts_limit: number | null;
  funder_reports_included_per_year: number | null;
  additional_report_fee_ngn: number | null;
  requires_custom_quote?: boolean;
  features: TierFeatures;
};

export type FeatureKey = keyof TierFeatures;

// §3 — Enterprise starts at this many learners a year and is never self-serve.
export const ENTERPRISE_THRESHOLD = 1000;
// Free first cohort: assessment fees waived for up to this many learners.
export const FREE_TRIAL_LEARNERS = 50;

// Tier configs are immutable per version, so an isolate can cache them forever.
const cache = new Map<string, TierConfig[]>();

export async function tiersForVersion(version: string): Promise<TierConfig[]> {
  const hit = cache.get(version);
  if (hit) return hit;
  const rows = await db.selectFrom('pricing_tiers').select(['tier_id', 'config_json']).where('pricing_version', '=', version).execute();
  if (!rows.length) throw new Error(`No pricing tiers for version ${version}`);
  const tiers = rows
    .map((r) => (typeof r.config_json === 'string' ? JSON.parse(r.config_json) : r.config_json) as TierConfig)
    .sort((a, b) => TIER_ORDER.indexOf(a.tier_id) - TIER_ORDER.indexOf(b.tier_id));
  cache.set(version, tiers);
  return tiers;
}

export async function tierConfig(version: string, tierId: string): Promise<TierConfig> {
  const tier = (await tiersForVersion(version)).find((t) => t.tier_id === tierId);
  if (!tier) throw new Error(`Unknown tier ${tierId} in pricing version ${version}`);
  return tier;
}

// §3 — tier from trailing-12-month volume.
export function determineTier(students: number): TierId {
  if (students < 250) return 'starter';
  if (students < 500) return 'growth';
  if (students < ENTERPRISE_THRESHOLD) return 'scale';
  return 'enterprise';
}

// §3 — "distinct learners assessed across all cohorts in the last 365 days":
// learners with a completed pre- or post-assessment in the window.
export async function trailingStudents(orgId: string): Promise<number> {
  const row = await db
    .selectFrom('assessment_sessions as s')
    .innerJoin('cohorts as co', 'co.id', 's.cohort_id')
    .innerJoin('courses as c', 'c.id', 'co.course_id')
    .select(sql<string>`count(distinct s.learner_id)`.as('n'))
    .where('c.org_id', '=', orgId)
    .where('s.status', 'in', ['completed', 'flagged'])
    .where('s.completed_at', '>=', sql<Date>`now() - interval '365 days'`)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

export async function loadOrgBilling(orgId: string) {
  const org = await db
    .selectFrom('organisations')
    .select([
      'id',
      'name',
      'contact_email',
      'created_at',
      'billing_status',
      'pricing_tier',
      'tier_effective_date',
      'billing_frequency',
      'pricing_version',
      'is_enterprise_custom',
      'custom_pricing_json',
      'projected_students_per_year',
      'free_cohorts_remaining',
      'billing_started_at',
      'current_period_start',
      'pending_tier',
    ])
    .where('id', '=', orgId)
    .executeTakeFirst();
  if (!org) throw notFound('Organisation not found');
  return org;
}

export type OrgBilling = Awaited<ReturnType<typeof loadOrgBilling>>;

// The org's effective tier config. Enterprise orgs with a negotiated deal
// have their custom_pricing_json merged over the Enterprise defaults (§6);
// self-serve tiers never use it.
export async function orgTier(org: OrgBilling): Promise<TierConfig> {
  const base = await tierConfig(org.pricing_version, org.pricing_tier);
  if (org.pricing_tier !== 'enterprise' || !org.is_enterprise_custom || !org.custom_pricing_json) return base;
  const custom = (typeof org.custom_pricing_json === 'string' ? JSON.parse(org.custom_pricing_json) : org.custom_pricing_json) as Partial<TierConfig>;
  return { ...base, ...custom, features: { ...base.features, ...(custom.features ?? {}) } };
}

export async function getOrgPlan(orgId: string) {
  const org = await loadOrgBilling(orgId);
  return { org, tier: await orgTier(org) };
}

function featureOn(features: TierFeatures, key: FeatureKey): boolean {
  const v = features[key];
  return Array.isArray(v) ? v.length > 0 : !!v;
}

// §5 — the single feature check, called server-side at the top of every
// gated endpoint.
export async function hasFeature(orgId: string, key: FeatureKey): Promise<boolean> {
  const { tier } = await getOrgPlan(orgId);
  return featureOn(tier.features, key);
}

const FEATURE_LABEL: Partial<Record<FeatureKey, string>> = {
  equity_dashboard: 'The equity dashboard',
  multi_cohort_trend_comparison: 'Comparing cohorts over time',
  live_funder_monitoring_link: 'Live funder links',
  tracer_survey: 'The follow-up (tracer) survey',
  certificate_white_label_option: 'White-label certificates',
};

// 403 with an upgrade prompt (§5: "not partial data"). The body names the
// lowest tier that includes the feature so the UI can say what unlocks it.
export async function assertFeature(orgId: string, key: FeatureKey) {
  const { org, tier } = await getOrgPlan(orgId);
  if (featureOn(tier.features, key)) return tier;
  const tiers = await tiersForVersion(org.pricing_version);
  const required = tiers.find((t) => featureOn(t.features, key));
  throw new AppError(403, 'UPGRADE_REQUIRED', `${FEATURE_LABEL[key] ?? 'This feature'} is included from the ${required?.display_name ?? 'next'} plan.`, {
    code: 'UPGRADE_REQUIRED',
    feature: key,
    current_tier: tier.tier_id,
    required_tier: required?.tier_id ?? null,
  });
}
