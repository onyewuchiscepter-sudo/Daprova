import { Router, type Request } from 'express';
import { z } from 'zod';
import { badRequest, unauthorized } from '../lib/errors.js';
import * as teachableService from '../services/teachableService.js';
import * as paymentService from '../services/paymentService.js';
import { isValidPaystackSignature } from '../services/payments/paystack.js';
import { isValidFlutterwaveHash } from '../services/payments/flutterwave.js';

export const webhooksRouter = Router();

const teachableWebhookSchema = z.object({ cohort_id: z.string().uuid(), enrolment_id: z.string().min(1) });

webhooksRouter.post('/teachable', async (req, res, next) => {
  try {
    const result = teachableWebhookSchema.safeParse(req.body);
    if (!result.success) throw badRequest('Invalid webhook payload', result.error.flatten());
    res.json(await teachableService.handleCourseCompletion(result.data.cohort_id, result.data.enrolment_id));
  } catch (err) {
    next(err);
  }
});

// docs/org-onboarding-spec.md §5.6 step 3. Both handlers authenticate the
// sender first, then treat the body only as a hint of *which* payment
// changed: resolvePayment re-asks the provider for the real outcome and
// checks the amount, so a replayed or forged event can't mark anything paid.
// Unknown references are acknowledged (200) so the provider stops retrying
// events for payments that aren't ours (e.g. other apps on the same account).
async function resolveFromWebhook(reference: string | undefined) {
  if (!reference) return { ignored: true };
  try {
    const payment = await paymentService.resolvePayment(reference);
    return { reference: payment.reference, status: payment.status };
  } catch (err) {
    if ((err as { status?: number }).status === 404) return { ignored: true };
    throw err;
  }
}

// Set this URL in Paystack → Settings → API Keys & Webhooks:
//   https://<api>/api/v1/webhooks/paystack
webhooksRouter.post('/paystack', async (req, res, next) => {
  try {
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!isValidPaystackSignature(raw, req.get('x-paystack-signature'))) throw unauthorized('Invalid Paystack signature');
    const reference = typeof req.body?.data?.reference === 'string' ? req.body.data.reference : undefined;
    res.json(await resolveFromWebhook(reference));
  } catch (err) {
    next(err);
  }
});

// Set this URL, plus a secret hash of your choice (also saved as the
// FLUTTERWAVE_WEBHOOK_HASH secret), in Flutterwave → Settings → Webhooks:
//   https://<api>/api/v1/webhooks/flutterwave
webhooksRouter.post('/flutterwave', async (req, res, next) => {
  try {
    if (!isValidFlutterwaveHash(req.get('verif-hash'))) throw unauthorized('Invalid Flutterwave webhook hash');
    const data = req.body?.data ?? req.body;
    const reference = typeof data?.tx_ref === 'string' ? data.tx_ref : typeof data?.txRef === 'string' ? data.txRef : undefined;
    res.json(await resolveFromWebhook(reference));
  } catch (err) {
    next(err);
  }
});
