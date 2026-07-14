import crypto from 'node:crypto';
import { notFound } from '../lib/errors.js';

// Stand-in for Paystack/Flutterwave (docs/org-onboarding-spec.md §5.6) —
// the user chose to build the payments flow now against a stub so the
// schema/webhook/reconciliation logic is provably correct, and swap in a
// real provider later without changing anything downstream of this module.
// State lives in-process, deliberately separate from our own `payments`
// table: a real provider's record of "did this succeed" is a genuinely
// separate system from ours, and the reconciliation job (paymentJobs.ts)
// needs that separation to mean anything when it polls provider state that
// our webhook hasn't heard about yet.
type ProviderStatus = 'pending' | 'success' | 'failed';
const store = new Map<string, ProviderStatus>();

export function createCheckoutSession(amount: number): { reference: string; checkoutUrl: string } {
  const reference = crypto.randomUUID();
  store.set(reference, 'pending');
  return { reference, checkoutUrl: `/api/v1/payments/stub-checkout/${reference}?amount=${amount}` };
}

export function simulateOutcome(reference: string, outcome: 'success' | 'failed'): void {
  if (!store.has(reference)) throw notFound('Unknown payment reference');
  store.set(reference, outcome);
}

export function getProviderStatus(reference: string): ProviderStatus | undefined {
  return store.get(reference);
}
