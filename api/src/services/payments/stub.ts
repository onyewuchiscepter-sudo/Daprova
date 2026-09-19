import { sql } from 'kysely';
import { db } from '../../db/index.js';
import { notFound } from '../../lib/errors.js';
import type { PaymentProvider } from './types.js';

// Stand-in provider used until real keys are configured. Its "provider
// side" state lives in its own table, deliberately separate from our
// payments table, so the webhook-less reconciliation path gets exercised the
// same way it does for a real provider.
export const stub: PaymentProvider = {
  name: 'stub',
  isConfigured: () => true,

  async initialize(req) {
    await db.insertInto('payment_stub_state').values({ reference: req.reference }).execute();
    return { checkoutUrl: `/api/v1/payments/stub-checkout/${req.reference}` };
  },

  async verify(reference) {
    const row = await db.selectFrom('payment_stub_state').select('status').where('reference', '=', reference).executeTakeFirst();
    if (!row) return { status: 'pending' };
    return { status: row.status === 'success' ? 'success' : row.status === 'failed' ? 'failed' : 'pending' };
  },
};

export async function simulateStubOutcome(reference: string, outcome: 'success' | 'failed') {
  const row = await db
    .updateTable('payment_stub_state')
    .set({ status: outcome, updated_at: sql`now()` })
    .where('reference', '=', reference)
    .returning('reference')
    .executeTakeFirst();
  if (!row) throw notFound('Unknown payment reference');
}
