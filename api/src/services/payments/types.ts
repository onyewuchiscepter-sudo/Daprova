export type ProviderName = 'paystack' | 'flutterwave' | 'stub';

export type CheckoutRequest = {
  reference: string;
  amountNaira: number;
  email: string;
  description: string;
  // Where the provider sends the customer back after paying (admin-web).
  callbackUrl: string;
  metadata: Record<string, string>;
};

export type VerifyResult = {
  status: 'success' | 'failed' | 'pending';
  // What the provider says was actually charged — checked against our own
  // invoice before a payment is honoured, never trusted on its own.
  amountNaira?: number;
  currency?: string;
  providerTransactionId?: string;
  failureReason?: string;
};

export interface PaymentProvider {
  name: ProviderName;
  isConfigured(): boolean;
  initialize(req: CheckoutRequest): Promise<{ checkoutUrl: string }>;
  verify(reference: string): Promise<VerifyResult>;
}
