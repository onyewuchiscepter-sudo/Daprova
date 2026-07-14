import { sql } from 'kysely';
import { db } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { getNextTier, getTier } from './pricingService.js';
import { createCheckoutSession, getProviderStatus } from './paymentProviderStub.js';

async function assertCohortInOrg(orgId: string, cohortId: string) {
  const cohort = await db
    .selectFrom('cohorts')
    .innerJoin('courses', 'courses.id', 'cohorts.course_id')
    .selectAll('cohorts')
    .where('cohorts.id', '=', cohortId)
    .where('courses.org_id', '=', orgId)
    .executeTakeFirst();
  if (!cohort) throw notFound('Cohort not found');
  return cohort;
}

// docs/org-onboarding-spec.md §5.6 steps 1-2. Idempotent: calling this
// again while a payment is already pending for the cohort just returns
// that same invoice's checkout URL rather than opening a second one —
// otherwise every re-click of "Upgrade now" would mint a fresh reference
// and orphan the previous one.
export async function requestUpgrade(orgId: string, cohortId: string) {
  const cohort = await assertCohortInOrg(orgId, cohortId);
  if (!cohort.plan_tier_at_creation) {
    throw badRequest('This cohort has no assigned tier yet — it predates the pricing engine and is not billed.');
  }

  const existing = await db
    .selectFrom('payments')
    .selectAll()
    .where('cohort_id', '=', cohortId)
    .where('status', '=', 'pending')
    .executeTakeFirst();
  if (existing) {
    return { payment: existing, checkoutUrl: `/api/v1/payments/stub-checkout/${existing.reference}?amount=${existing.amount}` };
  }

  const targetTier = await getNextTier(cohort.plan_tier_at_creation);
  if (targetTier.price === null) {
    throw badRequest('The next tier is Enterprise, which requires a custom quote rather than self-serve payment — contact sales.');
  }

  const { reference, checkoutUrl } = createCheckoutSession(targetTier.price);
  const payment = await db
    .insertInto('payments')
    .values({
      org_id: orgId,
      cohort_id: cohortId,
      amount: String(targetTier.price),
      provider: 'stub',
      reference,
      target_tier: targetTier.tier_id,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  // docs/org-onboarding-spec.md §5.6 step 4 — locked immediately, not just
  // on failure: existing data stays visible/read-only, but nothing new
  // happens on this cohort until the payment resolves one way or the other.
  await db.updateTable('cohorts').set({ status: 'locked_pending_upgrade' }).where('id', '=', cohortId).execute();

  return { payment, checkoutUrl };
}

// Shared by both resolution paths (§5.6 steps 3 and 6): the webhook route
// (provider pushes the outcome) and the reconciliation job (we poll for it
// because the push never arrived). Idempotent — resolving an already-
// resolved payment is a no-op rather than double-applying the tier change.
export async function confirmPayment(reference: string, outcome: 'success' | 'failed') {
  const payment = await db.selectFrom('payments').selectAll().where('reference', '=', reference).executeTakeFirst();
  if (!payment) throw notFound('Payment not found');
  if (payment.status !== 'pending') return payment;

  if (outcome === 'failed') {
    return db.updateTable('payments').set({ status: 'failed' }).where('id', '=', payment.id).returningAll().executeTakeFirstOrThrow();
  }

  const cohort = await db.selectFrom('cohorts').select(['plan_tier_at_creation']).where('id', '=', payment.cohort_id).executeTakeFirst();
  const oldTier = cohort?.plan_tier_at_creation ?? null;

  const updated = await db
    .updateTable('payments')
    .set({ status: 'confirmed', paid_at: sql`now()` })
    .where('id', '=', payment.id)
    .returningAll()
    .executeTakeFirstOrThrow();

  // §5.6 step 3 + §5.4's mid-cohort-upgrade rule — re-tier the whole
  // cohort (not just the overage), unlock the new tier's features, and
  // reactivate it. Billing is on final total size, not split by when
  // students joined.
  await db
    .updateTable('cohorts')
    .set({ plan_tier_at_creation: payment.target_tier, status: 'active' })
    .where('id', '=', payment.cohort_id)
    .execute();
  await db.insertInto('cohort_tier_history').values({ cohort_id: payment.cohort_id, old_tier: oldTier, new_tier: payment.target_tier, payment_id: payment.id }).execute();

  return updated;
}

export async function listPayments(orgId: string) {
  return db.selectFrom('payments').selectAll().where('org_id', '=', orgId).orderBy('created_at', 'desc').execute();
}

export async function getStubCheckoutInfo(reference: string) {
  const payment = await db.selectFrom('payments').selectAll().where('reference', '=', reference).executeTakeFirst();
  if (!payment) throw notFound('Payment not found');
  const tier = await getTier(payment.target_tier);
  return { payment, tier };
}

// docs/org-onboarding-spec.md §5.6 step 6 — "poll payment provider status
// for pending payments on an interval, don't rely solely on webhook
// delivery." Catches exactly the case the webhook route doesn't: a
// provider-side outcome that never made it back to us as a push.
export async function reconcilePendingPayments(): Promise<{ checked: number; resolved: number }> {
  const pending = await db.selectFrom('payments').select(['reference']).where('status', '=', 'pending').execute();
  let resolved = 0;
  for (const p of pending) {
    const providerStatus = getProviderStatus(p.reference);
    if (providerStatus === 'success' || providerStatus === 'failed') {
      await confirmPayment(p.reference, providerStatus);
      resolved += 1;
    }
  }
  return { checked: pending.length, resolved };
}
