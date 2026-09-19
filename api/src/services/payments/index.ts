import { env } from '../../env.js';
import { flutterwave } from './flutterwave.js';
import { paystack } from './paystack.js';
import { stub } from './stub.js';
import type { PaymentProvider, ProviderName } from './types.js';

const PROVIDERS: Record<ProviderName, PaymentProvider> = { paystack, flutterwave, stub };

// The provider new checkouts go to. An explicit PAYMENT_PROVIDER wins, and
// fails loudly if its key is missing rather than silently taking money
// through a different gateway; otherwise the first configured real
// provider, else the stub.
export function activeProvider(): PaymentProvider {
  const chosen = env.paymentProvider as ProviderName | undefined;
  if (chosen) {
    const provider = PROVIDERS[chosen];
    if (!provider) throw new Error(`Unknown PAYMENT_PROVIDER "${chosen}"`);
    if (!provider.isConfigured()) throw new Error(`PAYMENT_PROVIDER is "${chosen}" but its secret key is not set`);
    return provider;
  }
  if (paystack.isConfigured()) return paystack;
  if (flutterwave.isConfigured()) return flutterwave;
  return stub;
}

// An existing payment is always checked with the provider it was opened
// with, even if the active provider has changed since.
export function providerFor(name: string): PaymentProvider {
  const provider = PROVIDERS[name as ProviderName];
  if (!provider) throw new Error(`Unknown payment provider "${name}"`);
  return provider;
}

// For the platform tool: which gateways are wired up, without exposing keys.
export function providerStatus() {
  let active: string;
  try {
    active = activeProvider().name;
  } catch (err) {
    active = `misconfigured: ${(err as Error).message}`;
  }
  return {
    active,
    paystack_configured: paystack.isConfigured(),
    flutterwave_configured: flutterwave.isConfigured(),
    flutterwave_webhook_hash_configured: !!env.flutterwaveWebhookHash,
  };
}

export type { PaymentProvider, ProviderName } from './types.js';
