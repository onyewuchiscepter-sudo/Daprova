import crypto from 'node:crypto';
import { sql } from 'kysely';
import { db } from '../db/index.js';
import { env } from '../env.js';
import { badRequest, notFound } from '../lib/errors.js';
import { getNextTier, getTier } from './pricingService.js';
import { activeProvider, providerFor } from './payments/index.js';

// A checkout nobody finishes shouldn't hold a cohort locked forever.
const ABANDON_AFTER_MS = 24 * 60 * 60 * 1000;

type UpgradePurpose = 'capacity' | 'feature';

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
// again while a payment is already pending for the cohort returns that same
// invoice's checkout URL rather than opening a second one — otherwise every
// re-click of "Upgrade now" would mint a fresh reference and orphan the
// previous one.
//
// purpose: "capacity" is the original flow (the cohort hit its student cap,
// so it's locked until the payment resolves); "feature" is upgrading to
// unlock a tier feature such as funder reports, which must not lock a
// cohort that is otherwise running fine.
export async function requestUpgrade(orgId: string, cohortId: string, purpose: UpgradePurpose = 'capacity') {
  const cohort = await assertCohortInOrg(orgId, cohortId);
  if (!cohort.plan_tier_at_creation) {
    throw badRequest('This cohort has no assigned tier yet — it predates the pricing engine and is not billed.');
  }

  const existing = await db.selectFrom('payments').selectAll().where('cohort_id', '=', cohortId).where('status', '=', 'pending').executeTakeFirst();
  if (existing?.checkout_url) return { payment: existing, checkoutUrl: existing.checkout_url };

  const targetTier = await getNextTier(cohort.plan_tier_at_creation);
  if (targetTier.price === null) {
    throw badRequest('The next tier is Enterprise, which requires a custom quote rather than self-serve payment — contact sales.');
  }

  const org = await db.selectFrom('organisations').select(['contact_email', 'name']).where('id', '=', orgId).executeTakeFirstOrThrow();
  const provider = activeProvider();
  const reference = `dpv_${crypto.randomUUID().replace(/-/g, '')}`;

  // Our invoice exists before the provider is called, so a provider-side
  // charge can always be matched back to a row even if we crash mid-way.
  const payment = await db
    .insertInto('payments')
    .values({ org_id: orgId, cohort_id: cohortId, amount: String(targetTier.price), provider: provider.name, reference, target_tier: targetTier.tier_id, purpose })
    .returningAll()
    .executeTakeFirstOrThrow();

  let checkoutUrl: string;
  try {
    ({ checkoutUrl } = await provider.initialize({
      reference,
      amountNaira: targetTier.price,
      email: org.contact_email,
      description: `${org.name}: upgrade "${cohort.name}" to ${targetTier.name}`,
      callbackUrl: `${env.adminDashboardOrigin}/cohorts/${cohortId}?payment=${reference}`,
      metadata: { org_id: orgId, cohort_id: cohortId, target_tier: targetTier.tier_id },
    }));
  } catch (err) {
    await db.updateTable('payments').set({ status: 'failed', failure_reason: (err as Error).message }).where('id', '=', payment.id).execute();
    throw badRequest(`Could not open the ${provider.name} checkout — please try again shortly.`);
  }

  const updated = await db.updateTable('payments').set({ checkout_url: checkoutUrl }).where('id', '=', payment.id).returningAll().executeTakeFirstOrThrow();

  // docs/org-onboarding-spec.md §5.6 step 4 — a capacity upgrade locks the
  // cohort immediately: existing data stays visible/read-only, but nothing
  // new happens until the payment resolves one way or the other.
  if (purpose === 'capacity') {
    await db.updateTable('cohorts').set({ status: 'locked_pending_upgrade' }).where('id', '=', cohortId).execute();
  }

  return { payment: updated, checkoutUrl };
}

async function unlockIfLocked(cohortId: string) {
  await db.updateTable('cohorts').set({ status: 'active' }).where('id', '=', cohortId).where('status', '=', 'locked_pending_upgrade').execute();
}

async function markUnsuccessful(paymentId: string, cohortId: string, status: 'failed' | 'abandoned', reason?: string) {
  const payment = await db
    .updateTable('payments')
    .set({ status, failure_reason: reason ?? null })
    .where('id', '=', paymentId)
    .where('status', '=', 'pending')
    .returningAll()
    .executeTakeFirst();
  await unlockIfLocked(cohortId);
  return payment;
}

// §5.6 step 3 + §5.4's mid-cohort-upgrade rule — re-tier the whole cohort
// (not just the overage), unlock the new tier's features, and reactivate it.
// The status guard makes a second delivery (webhook + reconciliation, or a
// retried webhook) a no-op instead of applying the tier change twice.
async function markConfirmed(paymentId: string, providerTransactionId?: string) {
  return db.transaction().execute(async (trx) => {
    const payment = await trx
      .updateTable('payments')
      .set({ status: 'confirmed', paid_at: sql`now()`, provider_transaction_id: providerTransactionId ?? null })
      .where('id', '=', paymentId)
      .where('status', '=', 'pending')
      .returningAll()
      .executeTakeFirst();
    if (!payment) return undefined;

    const cohort = await trx.selectFrom('cohorts').select(['plan_tier_at_creation']).where('id', '=', payment.cohort_id).executeTakeFirst();
    await trx.updateTable('cohorts').set({ plan_tier_at_creation: payment.target_tier, status: 'active' }).where('id', '=', payment.cohort_id).execute();
    await trx
      .insertInto('cohort_tier_history')
      .values({ cohort_id: payment.cohort_id, old_tier: cohort?.plan_tier_at_creation ?? null, new_tier: payment.target_tier, payment_id: payment.id })
      .execute();
    return payment;
  });
}

// The one place a payment's outcome is decided: always by asking the
// provider it was opened with (never by trusting a webhook body or a
// redirect's query string), and only honoured if the amount and currency
// actually charged match our invoice. Shared by the webhook routes, the
// "I've paid" redirect check and the reconciliation cron.
export async function resolvePayment(reference: string) {
  const payment = await db.selectFrom('payments').selectAll().where('reference', '=', reference).executeTakeFirst();
  if (!payment) throw notFound('Payment not found');
  if (payment.status !== 'pending') return payment;

  const result = await providerFor(payment.provider).verify(reference);

  if (result.status === 'success') {
    const expected = Number(payment.amount);
    const isStub = payment.provider === 'stub';
    if (!isStub && (result.currency !== 'NGN' || result.amountNaira === undefined || result.amountNaira < expected)) {
      console.error(`[payments] ${reference}: provider reported ${result.currency} ${result.amountNaira}, invoice is NGN ${expected}`);
      return (await markUnsuccessful(payment.id, payment.cohort_id, 'failed', 'Amount or currency did not match the invoice')) ?? payment;
    }
    return (await markConfirmed(payment.id, result.providerTransactionId)) ?? payment;
  }

  if (result.status === 'failed') {
    return (await markUnsuccessful(payment.id, payment.cohort_id, 'failed', result.failureReason)) ?? payment;
  }

  if (Date.now() - new Date(payment.created_at as unknown as string).getTime() > ABANDON_AFTER_MS) {
    return (await markUnsuccessful(payment.id, payment.cohort_id, 'abandoned', 'Checkout not completed within 24 hours')) ?? payment;
  }
  return payment;
}

// Called when the provider redirects the admin back to the cohort page, so
// the upgrade shows up immediately instead of on the next cron tick.
export async function verifyPaymentForOrg(orgId: string, reference: string) {
  const payment = await db.selectFrom('payments').select(['id']).where('reference', '=', reference).where('org_id', '=', orgId).executeTakeFirst();
  if (!payment) throw notFound('Payment not found');
  const resolved = await resolvePayment(reference);
  return { reference: resolved.reference, status: resolved.status, target_tier: resolved.target_tier, failure_reason: resolved.failure_reason };
}

export async function listPayments(orgId: string) {
  return db
    .selectFrom('payments')
    .select(['id', 'cohort_id', 'amount', 'status', 'provider', 'reference', 'target_tier', 'purpose', 'paid_at', 'created_at', 'failure_reason'])
    .where('org_id', '=', orgId)
    .orderBy('created_at', 'desc')
    .execute();
}

export async function getStubCheckoutInfo(reference: string) {
  const payment = await db.selectFrom('payments').selectAll().where('reference', '=', reference).where('provider', '=', 'stub').executeTakeFirst();
  if (!payment) throw notFound('Payment not found');
  const tier = await getTier(payment.target_tier);
  return { payment, tier };
}

// docs/org-onboarding-spec.md §5.6 step 6 — "poll payment provider status
// for pending payments on an interval, don't rely solely on webhook
// delivery." Catches a provider-side outcome that never reached us as a
// push, and expires abandoned checkouts. One bad payment (provider outage,
// bad key) is logged and skipped rather than stopping the rest.
export async function reconcilePendingPayments(): Promise<{ checked: number; resolved: number; errors: number }> {
  const pending = await db.selectFrom('payments').select(['reference']).where('status', '=', 'pending').execute();
  let resolved = 0;
  let errors = 0;
  for (const p of pending) {
    try {
      const after = await resolvePayment(p.reference);
      if (after.status !== 'pending') resolved += 1;
    } catch (err) {
      errors += 1;
      console.error(`[payment-reconciliation] ${p.reference} failed:`, (err as Error).message);
    }
  }
  return { checked: pending.length, resolved, errors };
}
