import crypto from 'node:crypto';
import { sql } from 'kysely';
import { db } from '../db/index.js';
import { env } from '../env.js';
import { badRequest, notFound } from '../lib/errors.js';
import { activeProvider, providerFor } from './payments/index.js';

// Paying invoices (Pricing & Billing Spec §6) through Paystack, Flutterwave
// or the test stub. A payment is one checkout attempt for one invoice; the
// invoice is marked paid only once the gateway confirms the full amount.

// A checkout nobody finishes is dropped after this long (the invoice stays
// open and can be paid again).
const ABANDON_AFTER_MS = 24 * 60 * 60 * 1000;

// Idempotent: while a checkout for the invoice is still open, the same
// checkout URL is returned instead of opening a second one.
export async function startInvoicePayment(orgId: string, invoiceId: string) {
  const invoice = await db.selectFrom('invoices').selectAll().where('id', '=', invoiceId).where('org_id', '=', orgId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!invoice) throw notFound('Invoice not found');
  if (invoice.status === 'paid') throw badRequest('This invoice is already paid.');
  if (invoice.status === 'void') throw badRequest('This invoice has been cancelled.');

  const existing = await db.selectFrom('payments').selectAll().where('invoice_id', '=', invoiceId).where('status', '=', 'pending').executeTakeFirst();
  if (existing?.checkout_url) return { payment: existing, checkoutUrl: existing.checkout_url };

  const org = await db.selectFrom('organisations').select(['contact_email', 'name']).where('id', '=', orgId).executeTakeFirstOrThrow();
  const provider = activeProvider();
  const reference = `dpv_${crypto.randomUUID().replace(/-/g, '')}`;
  const amount = Number(invoice.total_ngn);

  // Our record exists before the provider is called, so a provider-side
  // charge can always be matched back even if we crash mid-way.
  const payment = await db
    .insertInto('payments')
    .values({ org_id: orgId, cohort_id: invoice.cohort_id, amount: String(amount), provider: provider.name, reference, target_tier: null, purpose: 'invoice', invoice_id: invoiceId })
    .returningAll()
    .executeTakeFirstOrThrow();

  let checkoutUrl: string;
  try {
    ({ checkoutUrl } = await provider.initialize({
      reference,
      amountNaira: amount,
      email: org.contact_email,
      description: `${org.name}: Daprova invoice ${invoice.invoice_number}`,
      callbackUrl: `${env.adminDashboardOrigin}/billing?payment=${reference}`,
      metadata: { org_id: orgId, invoice_id: invoiceId, invoice_number: invoice.invoice_number },
    }));
  } catch (err) {
    await db.updateTable('payments').set({ status: 'failed', failure_reason: (err as Error).message }).where('id', '=', payment.id).execute();
    throw badRequest(`Could not open the ${provider.name} checkout — please try again shortly.`);
  }

  const updated = await db.updateTable('payments').set({ checkout_url: checkoutUrl }).where('id', '=', payment.id).returningAll().executeTakeFirstOrThrow();
  return { payment: updated, checkoutUrl };
}

async function markUnsuccessful(paymentId: string, status: 'failed' | 'abandoned', reason?: string) {
  return db
    .updateTable('payments')
    .set({ status, failure_reason: reason ?? null })
    .where('id', '=', paymentId)
    .where('status', '=', 'pending')
    .returningAll()
    .executeTakeFirst();
}

// The status guard makes a second delivery (webhook + reconciliation, or a
// retried webhook) a no-op.
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
    if (payment.invoice_id) {
      await trx
        .updateTable('invoices')
        .set({ status: 'paid', paid_at: sql`now()` })
        .where('id', '=', payment.invoice_id)
        .where('status', 'in', ['pending', 'overdue'])
        .execute();
    }
    return payment;
  });
}

// The one place a payment's outcome is decided: always by asking the
// provider it was opened with (never by trusting a webhook body or a
// redirect's query string), and only honoured if the amount and currency
// actually charged cover the invoice. Shared by the webhook routes, the
// post-checkout redirect check and the reconciliation cron.
export async function resolvePayment(reference: string) {
  const payment = await db.selectFrom('payments').selectAll().where('reference', '=', reference).executeTakeFirst();
  if (!payment) throw notFound('Payment not found');
  if (payment.status !== 'pending') return payment;

  const result = await providerFor(payment.provider).verify(reference);

  if (result.status === 'success') {
    const expected = Number(payment.amount);
    if (payment.provider !== 'stub' && (result.currency !== 'NGN' || result.amountNaira === undefined || result.amountNaira < expected)) {
      console.error(`[payments] ${reference}: provider reported ${result.currency} ${result.amountNaira}, expected NGN ${expected}`);
      return (await markUnsuccessful(payment.id, 'failed', 'Amount or currency did not match the invoice')) ?? payment;
    }
    return (await markConfirmed(payment.id, result.providerTransactionId)) ?? payment;
  }
  if (result.status === 'failed') {
    return (await markUnsuccessful(payment.id, 'failed', result.failureReason)) ?? payment;
  }
  if (Date.now() - new Date(payment.created_at as unknown as string).getTime() > ABANDON_AFTER_MS) {
    return (await markUnsuccessful(payment.id, 'abandoned', 'Checkout not completed within 24 hours')) ?? payment;
  }
  return payment;
}

// Called when the gateway redirects the admin back to the Billing page, so
// the invoice shows as paid immediately rather than on the next cron tick.
export async function verifyPaymentForOrg(orgId: string, reference: string) {
  const payment = await db.selectFrom('payments').select(['id']).where('reference', '=', reference).where('org_id', '=', orgId).executeTakeFirst();
  if (!payment) throw notFound('Payment not found');
  const resolved = await resolvePayment(reference);
  const invoice = resolved.invoice_id
    ? await db.selectFrom('invoices').select(['invoice_number', 'status']).where('id', '=', resolved.invoice_id).executeTakeFirst()
    : undefined;
  return { reference: resolved.reference, status: resolved.status, failure_reason: resolved.failure_reason, invoice_number: invoice?.invoice_number ?? null, invoice_status: invoice?.status ?? null };
}

export async function listPayments(orgId: string) {
  return db
    .selectFrom('payments')
    .select(['id', 'invoice_id', 'amount', 'status', 'provider', 'reference', 'purpose', 'paid_at', 'created_at', 'failure_reason'])
    .where('org_id', '=', orgId)
    .orderBy('created_at', 'desc')
    .execute();
}

export async function getStubCheckoutInfo(reference: string) {
  const payment = await db.selectFrom('payments').selectAll().where('reference', '=', reference).where('provider', '=', 'stub').executeTakeFirst();
  if (!payment) throw notFound('Payment not found');
  const invoice = payment.invoice_id ? await db.selectFrom('invoices').select(['invoice_number']).where('id', '=', payment.invoice_id).executeTakeFirst() : undefined;
  return { payment, label: invoice ? `Invoice ${invoice.invoice_number}` : 'Daprova payment' };
}

// docs/org-onboarding-spec.md §5.6 step 6 — poll the provider for pending
// payments rather than relying only on webhooks, and expire abandoned
// checkouts. One bad payment is logged and skipped.
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
