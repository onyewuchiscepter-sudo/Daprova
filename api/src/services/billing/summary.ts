import { db } from '../../db/index.js';
import { blockingInvoice, BLOCK_AFTER_OVERDUE_DAYS } from './invoices.js';
import { AUTO_FINALIZE_AFTER_DAYS } from './lifecycle.js';
import { FREE_TRIAL_LEARNERS, determineTier, loadOrgBilling, orgTier, tiersForVersion, trailingStudents, ENTERPRISE_THRESHOLD, isTierLocked } from './plan.js';
import { quotaStatus } from './quota.js';

// Everything the org's Billing page shows, in one call.
export async function billingSummary(orgId: string) {
  const org = await loadOrgBilling(orgId);
  const [tier, tiers, trailing, blocking] = await Promise.all([orgTier(org), tiersForVersion(org.pricing_version), trailingStudents(orgId), blockingInvoice(orgId)]);
  const quota = await quotaStatus(org, tier);

  const openCohorts = await db
    .selectFrom('cohorts')
    .innerJoin('courses', 'courses.id', 'cohorts.course_id')
    .select(['cohorts.id', 'cohorts.name', 'cohorts.is_free_trial', 'cohorts.status'])
    .where('courses.org_id', '=', orgId)
    .where('cohorts.deleted_at', 'is', null)
    .where('cohorts.finalized_at', 'is', null)
    .execute();

  const outstanding = await db
    .selectFrom('invoices')
    .select(({ fn }) => [fn.sum<string>('total_ngn').as('total'), fn.countAll<string>().as('n')])
    .where('org_id', '=', orgId)
    .where('status', 'in', ['pending', 'overdue'])
    .where('deleted_at', 'is', null)
    .executeTakeFirstOrThrow();

  const byVolume = determineTier(trailing);
  const periodStart = org.current_period_start ? new Date(org.current_period_start as unknown as string) : null;
  const nextMonthly = periodStart ? new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, periodStart.getUTCDate(), periodStart.getUTCHours(), periodStart.getUTCMinutes())) : null;

  return {
    pricing_version: org.pricing_version,
    billing_status: org.billing_status,
    billing_frequency: org.billing_frequency,
    is_enterprise_custom: org.is_enterprise_custom,
    tier,
    tier_effective_date: org.tier_effective_date,
    pending_tier: isTierLocked(org) ? null : org.pending_tier,
    // Set by Daprova rather than by volume (see isTierLocked).
    tier_lock: isTierLocked(org) ? { until: org.tier_locked_until } : null,
    volume: {
      trailing_12_months: trailing,
      tier_by_volume: byVolume,
      band_min: tier.students_per_year_min,
      band_max: tier.students_per_year_max,
      projected: org.projected_students_per_year,
      enterprise_threshold: ENTERPRISE_THRESHOLD,
    },
    cohorts: {
      open: openCohorts.length,
      limit: tier.concurrent_cohorts_limit,
      auto_finalize_after_days: AUTO_FINALIZE_AFTER_DAYS,
    },
    trial: {
      active: !org.billing_started_at,
      free_cohorts_remaining: org.free_cohorts_remaining,
      free_learners: FREE_TRIAL_LEARNERS,
      trial_cohort: openCohorts.find((c) => c.is_free_trial) ?? null,
    },
    next_base_invoice:
      !org.billing_started_at || tier.base_fee_monthly_ngn === null
        ? null
        : org.billing_frequency === 'monthly'
          ? { date: nextMonthly?.toISOString() ?? null, amount_ngn: tier.base_fee_monthly_ngn, basis: 'monthly' }
          : { date: null, amount_ngn: tier.base_fee_per_cohort_cycle_ngn, basis: 'per_cohort_cycle' },
    quota,
    outstanding: { count: Number(outstanding.n), total_ngn: Number(outstanding.total ?? 0) },
    blocked: blocking ? { invoice_id: blocking.id, invoice_number: blocking.invoice_number, after_days: BLOCK_AFTER_OVERDUE_DAYS } : null,
    tiers,
  };
}
