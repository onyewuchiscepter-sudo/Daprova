import crypto from 'node:crypto';
import { env } from '../../env.js';
import type { CheckoutRequest, PaymentProvider, VerifyResult } from './types.js';

// https://developer.flutterwave.com/docs/collecting-payments/standard — v3,
// amounts in naira. Our payment reference is Flutterwave's tx_ref.
const BASE = 'https://api.flutterwave.com/v3';

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!env.flutterwaveSecretKey) throw new Error('FLUTTERWAVE_SECRET_KEY is not set');
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.flutterwaveSecretKey}`, 'Content-Type': 'application/json' },
  });
  const body = (await res.json().catch(() => ({}))) as { status?: string; message?: string; data?: unknown };
  if (!res.ok || body.status !== 'success') throw new Error(`Flutterwave ${path.split('?')[0]} failed: ${body.message ?? res.status}`);
  return body.data as T;
}

export const flutterwave: PaymentProvider = {
  name: 'flutterwave',
  isConfigured: () => !!env.flutterwaveSecretKey,

  async initialize(req: CheckoutRequest) {
    const data = await call<{ link: string }>('/payments', {
      method: 'POST',
      body: JSON.stringify({
        tx_ref: req.reference,
        amount: req.amountNaira,
        currency: 'NGN',
        redirect_url: req.callbackUrl,
        customer: { email: req.email },
        customizations: { title: 'Daprova', description: req.description },
        meta: req.metadata,
      }),
    });
    return { checkoutUrl: data.link };
  },

  async verify(reference: string): Promise<VerifyResult> {
    let data: { status: string; amount: number; currency: string; id: number; processor_response?: string };
    try {
      data = await call(`/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`);
    } catch (err) {
      // "No transaction was found" until the customer actually attempts a
      // payment — that's still pending, not failed.
      if (err instanceof Error && /no transaction/i.test(err.message)) return { status: 'pending' };
      throw err;
    }
    const status = data.status === 'successful' ? 'success' : data.status === 'failed' ? 'failed' : 'pending';
    return {
      status,
      amountNaira: data.amount,
      currency: data.currency,
      providerTransactionId: String(data.id),
      failureReason: status === 'failed' ? data.processor_response : undefined,
    };
  },
};

// Flutterwave echoes the secret hash you set in its dashboard (Settings →
// Webhooks) back verbatim in the verif-hash header.
export function isValidFlutterwaveHash(header: string | undefined): boolean {
  if (!env.flutterwaveWebhookHash || !header) return false;
  const a = Buffer.from(env.flutterwaveWebhookHash);
  const b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
