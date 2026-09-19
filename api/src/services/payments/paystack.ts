import crypto from 'node:crypto';
import { env } from '../../env.js';
import type { CheckoutRequest, PaymentProvider, VerifyResult } from './types.js';

// https://paystack.com/docs/api/transaction/ — amounts are in kobo.
const BASE = 'https://api.paystack.co';

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!env.paystackSecretKey) throw new Error('PAYSTACK_SECRET_KEY is not set');
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.paystackSecretKey}`, 'Content-Type': 'application/json' },
  });
  const body = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: unknown };
  if (!res.ok || body.status === false) throw new Error(`Paystack ${path.split('?')[0]} failed: ${body.message ?? res.status}`);
  return body.data as T;
}

export const paystack: PaymentProvider = {
  name: 'paystack',
  isConfigured: () => !!env.paystackSecretKey,

  async initialize(req: CheckoutRequest) {
    const data = await call<{ authorization_url: string }>('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        email: req.email,
        amount: Math.round(req.amountNaira * 100),
        currency: 'NGN',
        reference: req.reference,
        callback_url: req.callbackUrl,
        metadata: { ...req.metadata, description: req.description },
      }),
    });
    return { checkoutUrl: data.authorization_url };
  },

  async verify(reference: string): Promise<VerifyResult> {
    let data: { status: string; amount: number; currency: string; id: number; gateway_response?: string };
    try {
      data = await call(`/transaction/verify/${encodeURIComponent(reference)}`);
    } catch (err) {
      // Paystack answers "Transaction reference not found" until the
      // customer actually opens the checkout — still pending, not failed.
      if (err instanceof Error && /not found/i.test(err.message)) return { status: 'pending' };
      throw err;
    }
    // success | failed | abandoned | ongoing | pending | processing | queued | reversed
    const status = data.status === 'success' ? 'success' : data.status === 'failed' || data.status === 'reversed' ? 'failed' : 'pending';
    return {
      status,
      amountNaira: data.amount / 100,
      currency: data.currency,
      providerTransactionId: String(data.id),
      failureReason: status === 'failed' ? data.gateway_response : undefined,
    };
  },
};

// Paystack signs the raw request body with HMAC-SHA512 using your secret
// key and sends it as x-paystack-signature.
export function isValidPaystackSignature(rawBody: Buffer | undefined, signature: string | undefined): boolean {
  if (!env.paystackSecretKey || !rawBody || !signature) return false;
  const expected = crypto.createHmac('sha512', env.paystackSecretKey).update(rawBody).digest('hex');
  return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
