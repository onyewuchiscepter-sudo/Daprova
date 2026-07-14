import { db } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';

export const ENTERPRISE_THRESHOLD = 1001;

export type PlanTier = {
  tier_id: string;
  name: string;
  min_students: number;
  max_students: number | null;
  price: number | null;
  features: string[];
};

export async function getTier(tierId: string): Promise<PlanTier> {
  const row = await db.selectFrom('plan_tiers').selectAll().where('tier_id', '=', tierId).executeTakeFirst();
  if (!row) throw notFound(`Unknown plan tier: ${tierId}`);
  return { ...row, features: row.features as string[] };
}

// The upgrade path a paid cohort actually follows. FREE_TRIAL is
// deliberately not its own rung — it shares ENTRY's student range (1-50),
// so "the next tier after FREE_TRIAL" needs to be GROWTH, not ENTRY (which
// would still be at the same cap the cohort just hit).
const UPGRADE_PATH = ['ENTRY', 'GROWTH', 'SCALE_1', 'SCALE_2', 'ENTERPRISE'] as const;

// docs/org-onboarding-spec.md §5.6 step 1 — "cohort reaches a tier
// requiring payment": the next rung up from wherever it is now. Throws if
// already at the top of the self-serve path (Enterprise has no fixed price
// — that's a sales conversation, §5.5, not a payment to collect).
export async function getNextTier(currentTierId: string): Promise<PlanTier> {
  const normalized = currentTierId === 'FREE_TRIAL' ? 'ENTRY' : currentTierId;
  const index = UPGRADE_PATH.indexOf(normalized as (typeof UPGRADE_PATH)[number]);
  if (index === -1 || index === UPGRADE_PATH.length - 1) {
    throw badRequest('This cohort is already at the top of the self-serve pricing path — contact sales for a custom quote.');
  }
  return getTier(UPGRADE_PATH[index + 1]);
}

// Excludes FREE_TRIAL deliberately — that tier is only ever assigned via
// free-trial eligibility (below), never by student count alone, since its
// range (1-50) overlaps ENTRY's.
export async function getTierForStudentCount(studentCount: number): Promise<PlanTier> {
  if (studentCount >= ENTERPRISE_THRESHOLD) return getTier('ENTERPRISE');
  const row = await db
    .selectFrom('plan_tiers')
    .selectAll()
    .where('tier_id', '!=', 'FREE_TRIAL')
    .where('min_students', '<=', studentCount)
    .where((eb) => eb.or([eb('max_students', 'is', null), eb('max_students', '>=', studentCount)]))
    .orderBy('min_students')
    .executeTakeFirst();
  if (!row) throw notFound(`No plan tier covers ${studentCount} students`);
  return { ...row, features: row.features as string[] };
}

// docs/org-onboarding-spec.md §5.4 — checked once, at first-cohort
// creation. has_used_free_trial flips true the instant that cohort is
// created (assignTierForNewCohort does this), regardless of outcome, so
// checking this single flag is sufficient — there's no separate
// cohort_number check needed.
export async function isEligibleForFreeTrial(orgId: string): Promise<boolean> {
  const org = await db.selectFrom('organisations').select('has_used_free_trial').where('id', '=', orgId).executeTakeFirst();
  if (!org) throw notFound('Organisation not found');
  return !org.has_used_free_trial;
}

// docs/org-onboarding-spec.md §4.4/§5.5 — the pricing spec's
// getCohortPricing() pseudocode, plus the Enterprise pre-check that skips
// both free-trial and normal tier assignment entirely.
export async function assignTierForNewCohort(
  orgId: string,
  cohortId: string,
  projectedStudentCount: number,
): Promise<{ tier: PlanTier; isFreeTrial: boolean; cohortStatus: 'active' | 'pending_manual_quote' }> {
  if (projectedStudentCount >= ENTERPRISE_THRESHOLD) {
    const tier = await getTier('ENTERPRISE');
    await recordTierChange(cohortId, null, tier.tier_id);
    return { tier, isFreeTrial: false, cohortStatus: 'pending_manual_quote' };
  }

  const eligible = await isEligibleForFreeTrial(orgId);
  if (eligible) {
    const tier = await getTier('FREE_TRIAL');
    await db.updateTable('organisations').set({ has_used_free_trial: true }).where('id', '=', orgId).execute();
    await recordTierChange(cohortId, null, tier.tier_id);
    return { tier, isFreeTrial: true, cohortStatus: 'active' };
  }

  const tier = await getTierForStudentCount(projectedStudentCount);
  await recordTierChange(cohortId, null, tier.tier_id);
  return { tier, isFreeTrial: false, cohortStatus: 'active' };
}

async function recordTierChange(cohortId: string, oldTier: string | null, newTier: string) {
  await db.insertInto('cohort_tier_history').values({ cohort_id: cohortId, old_tier: oldTier, new_tier: newTier }).execute();
}

export type CapacityStatus = 'allow' | 'warn' | 'block';

// docs/org-onboarding-spec.md §5.4's canAddStudent() — Enterprise
// (max_students null) is never capped.
export async function checkCapacity(cohortId: string): Promise<{ status: CapacityStatus; studentCount: number; maxStudents: number | null }> {
  const cohort = await db.selectFrom('cohorts').select(['student_count', 'plan_tier_at_creation']).where('id', '=', cohortId).executeTakeFirst();
  if (!cohort) throw notFound('Cohort not found');
  if (!cohort.plan_tier_at_creation) return { status: 'allow', studentCount: cohort.student_count, maxStudents: null };

  const tier = await getTier(cohort.plan_tier_at_creation);
  if (tier.max_students === null) return { status: 'allow', studentCount: cohort.student_count, maxStudents: null };

  if (cohort.student_count >= tier.max_students) return { status: 'block', studentCount: cohort.student_count, maxStudents: tier.max_students };
  if (cohort.student_count >= tier.max_students * 0.9) return { status: 'warn', studentCount: cohort.student_count, maxStudents: tier.max_students };
  return { status: 'allow', studentCount: cohort.student_count, maxStudents: tier.max_students };
}

export async function assertCapacityAvailable(cohortId: string) {
  const capacity = await checkCapacity(cohortId);
  if (capacity.status === 'block') {
    throw badRequest(`This cohort has reached its plan's limit of ${capacity.maxStudents} students — upgrade to enrol more.`);
  }
}

// docs/org-onboarding-spec.md §5.3/§5.7 — pricing (and therefore feature
// flags) are per-cohort, not per-org: two simultaneous cohorts are "priced/
// tiered independently by their own cohort_number/size". Gating on
// organisations.current_plan_tier would be wrong — it would let an
// ENTRY-tier cohort's report through just because another cohort in the
// same org happens to be on GROWTH, or block a GROWTH cohort because
// another is still on ENTRY. Scoped by orgId as well (not just cohortId) to
// match the ownership check every other cohort-scoped service function does.
export async function hasFeature(orgId: string, cohortId: string, featureKey: string): Promise<boolean> {
  const cohort = await db
    .selectFrom('cohorts')
    .innerJoin('courses', 'courses.id', 'cohorts.course_id')
    .select('cohorts.plan_tier_at_creation')
    .where('cohorts.id', '=', cohortId)
    .where('courses.org_id', '=', orgId)
    .executeTakeFirst();
  if (!cohort) throw notFound('Cohort not found');
  // Cohorts created before the pricing engine (Sprint 4) have no tier
  // assigned — grandfathered in rather than retroactively blocked, matching
  // checkCapacity's treatment of the same pre-existing-cohort case.
  if (!cohort.plan_tier_at_creation) return true;
  const tier = await getTier(cohort.plan_tier_at_creation);
  return tier.features.includes(featureKey);
}

export async function assertFeature(orgId: string, cohortId: string, featureKey: string) {
  if (!(await hasFeature(orgId, cohortId, featureKey))) {
    throw badRequest(`This feature requires a plan upgrade (${featureKey} is not included in this cohort's current tier).`);
  }
}
