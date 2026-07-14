import { Router } from 'express';
import { z } from 'zod';
import { badRequest } from '../lib/errors.js';
import * as teachableService from '../services/teachableService.js';
import * as paymentService from '../services/paymentService.js';

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

// docs/org-onboarding-spec.md §5.6 step 3. A real Paystack/Flutterwave
// integration would verify a signature header here before trusting the
// body — skipped for the stub provider (paymentProviderStub.ts), but a
// real swap-in would need that check added at the top of this handler.
const paymentWebhookSchema = z.object({ reference: z.string().min(1), status: z.enum(['success', 'failed']) });
webhooksRouter.post('/payments', async (req, res, next) => {
  try {
    const result = paymentWebhookSchema.safeParse(req.body);
    if (!result.success) throw badRequest('Invalid webhook payload', result.error.flatten());
    res.json(await paymentService.confirmPayment(result.data.reference, result.data.status));
  } catch (err) {
    next(err);
  }
});
