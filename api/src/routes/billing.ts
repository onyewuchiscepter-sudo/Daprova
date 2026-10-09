import { Router } from 'express';
import { z } from 'zod';
import { badRequest } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import * as billing from '../services/billing/index.js';
import * as paymentService from '../services/paymentService.js';

// The org's own view of its plan, usage and invoices (Pricing & Billing Spec).
export const billingRouter = Router();
billingRouter.use(requireAuth, requireRole('admin'));

billingRouter.get('/', async (req, res, next) => {
  try {
    res.json(await billing.billingSummary(req.auth!.org_id!));
  } catch (err) {
    next(err);
  }
});

billingRouter.get('/invoices', async (req, res, next) => {
  try {
    res.json(await billing.listInvoices(req.auth!.org_id!));
  } catch (err) {
    next(err);
  }
});

// Opens a gateway checkout for one invoice; the gateway sends the admin back
// to /billing?payment=<reference>, which calls /payments/:ref/verify.
billingRouter.post('/invoices/:id/pay', async (req, res, next) => {
  try {
    res.status(201).json(await paymentService.startInvoicePayment(req.auth!.org_id!, req.params.id));
  } catch (err) {
    next(err);
  }
});

// Self-serve plan choice (services/billing/selfServe.ts). The quote is what
// the admin sees before confirming; POST applies it or, when something is
// due now, opens a checkout for it.
const planSchema = z.object({ tier: z.enum(['starter', 'growth', 'scale']), billing_frequency: z.enum(['monthly', 'per_cohort_cycle']) });

billingRouter.get('/plan/quote', async (req, res, next) => {
  try {
    const body = planSchema.safeParse(req.query);
    if (!body.success) throw badRequest('Choose a plan and billing frequency', body.error.flatten());
    res.json(await billing.quotePlanChange(req.auth!.org_id!, body.data.tier, body.data.billing_frequency));
  } catch (err) {
    next(err);
  }
});

billingRouter.post('/plan', async (req, res, next) => {
  try {
    const body = planSchema.safeParse(req.body);
    if (!body.success) throw badRequest('Choose a plan and billing frequency', body.error.flatten());
    const orgId = req.auth!.org_id!;
    const result = await billing.changePlan(orgId, req.auth!.sub, body.data.tier, body.data.billing_frequency);
    if (result.applied) {
      res.json({ applied: true, summary: result.summary });
      return;
    }
    const { checkoutUrl } = await paymentService.startInvoicePayment(orgId, result.invoice.id);
    res.status(201).json({ applied: false, summary: result.summary, invoice_id: result.invoice.id, checkoutUrl });
  } catch (err) {
    next(err);
  }
});
