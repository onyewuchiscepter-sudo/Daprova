import { Router } from 'express';
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
