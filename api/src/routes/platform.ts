import { Router } from 'express';
import { db } from '../db/index.js';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requirePlatformRole } from '../middleware/platformAuth.js';
import { badRequest } from '../lib/errors.js';
import * as platformService from '../services/platformService.js';
import { reconcilePendingPayments } from '../services/paymentService.js';
import { providerStatus } from '../services/payments/index.js';

export const platformRouter = Router();
platformRouter.use(requireAuth, requirePlatformRole('support', 'owner'));

platformRouter.get('/orgs', async (req, res, next) => {
  try {
    res.json(await platformService.listOrgs());
  } catch (err) {
    next(err);
  }
});

// Must be registered before GET /orgs/:id below — otherwise Express's
// route-matching order makes /orgs/:id shadow this literal path (the
// bug this comment is here to prevent regressing).
platformRouter.get('/orgs/pending-verification', async (_req, res, next) => {
  try {
    res.json(await platformService.listPendingVerificationOrgs());
  } catch (err) {
    next(err);
  }
});

platformRouter.get('/orgs/:id', async (req, res, next) => {
  try {
    res.json(await platformService.getOrgDetail(req.params.id));
  } catch (err) {
    next(err);
  }
});

const createOrgSchema = z.object({
  org_name: z.string().min(1),
  org_slug: z.string().min(1),
  contact_email: z.string().email(),
  admin_email: z.string().email(),
  admin_display_name: z.string().optional(),
  admin_password: z.string().min(8),
});
platformRouter.post('/orgs', async (req, res, next) => {
  try {
    const body = createOrgSchema.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    const result = await platformService.createOrgWithAdmin(req.auth!.sub, body.data);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// docs/org-onboarding-spec.md §5.6 step 6 — manually triggerable so this
// can be tested deterministically, on top of the interval-driven run
// wired up in index.ts.
platformRouter.post('/payments/reconcile', async (_req, res, next) => {
  try {
    res.json(await reconcilePendingPayments());
  } catch (err) {
    next(err);
  }
});

// Which payment gateway new checkouts use and whether each has its keys —
// booleans only, never the keys themselves.
platformRouter.get('/payments/providers', (_req, res) => {
  res.json(providerStatus());
});

// The 50 most recent payments across every org.
platformRouter.get('/payments', async (_req, res, next) => {
  try {
    res.json(
      await db
        .selectFrom('payments')
        .innerJoin('organisations', 'organisations.id', 'payments.org_id')
        .select(['payments.reference', 'payments.amount', 'payments.status', 'payments.provider', 'payments.target_tier', 'payments.purpose', 'payments.created_at', 'payments.paid_at', 'payments.failure_reason', 'organisations.name as org_name'])
        .orderBy('payments.created_at', 'desc')
        .limit(50)
        .execute(),
    );
  } catch (err) {
    next(err);
  }
});

platformRouter.get('/fraud-flags', async (_req, res, next) => {
  try {
    res.json(await platformService.listFraudFlags());
  } catch (err) {
    next(err);
  }
});

const reviewFraudFlagSchema = z.object({ decision: z.enum(['approved', 'rejected']) });
platformRouter.post('/fraud-flags/:id/review', async (req, res, next) => {
  try {
    const body = reviewFraudFlagSchema.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    res.json(await platformService.reviewFraudFlag(req.auth!.sub, req.params.id, body.data.decision));
  } catch (err) {
    next(err);
  }
});

// `support` is sufficient for verifying (view/verify aren't billing
// actions); ban stays owner-only below, same split as fraud-flags above.
platformRouter.post('/orgs/:id/verify', async (req, res, next) => {
  try {
    res.json(await platformService.verifyOrg(req.auth!.sub, req.params.id));
  } catch (err) {
    next(err);
  }
});

// docs/org-onboarding-spec.md §7.2 — everything below is `owner`-only.
// Re-applying requirePlatformRole here (rather than relying only on the
// router-level support+owner gate above) is what actually narrows it —
// `support` can view and review fraud flags, but not touch billing state.
const ownerOnly = requirePlatformRole('owner');

platformRouter.post('/orgs/:id/suspend', ownerOnly, async (req, res, next) => {
  try {
    res.json(await platformService.suspendOrg(req.auth!.sub, req.params.id));
  } catch (err) {
    next(err);
  }
});

platformRouter.post('/orgs/:id/reactivate', ownerOnly, async (req, res, next) => {
  try {
    res.json(await platformService.reactivateOrg(req.auth!.sub, req.params.id));
  } catch (err) {
    next(err);
  }
});

platformRouter.post('/orgs/:id/close', ownerOnly, async (req, res, next) => {
  try {
    res.json(await platformService.closeOrg(req.auth!.sub, req.params.id));
  } catch (err) {
    next(err);
  }
});

platformRouter.post('/orgs/:id/ban', ownerOnly, async (req, res, next) => {
  try {
    res.json(await platformService.banOrg(req.auth!.sub, req.params.id));
  } catch (err) {
    next(err);
  }
});

platformRouter.post('/orgs/:id/extend-free-trial', ownerOnly, async (req, res, next) => {
  try {
    res.json(await platformService.extendFreeTrial(req.auth!.sub, req.params.id));
  } catch (err) {
    next(err);
  }
});

const correctBillingStatusSchema = z.object({ status: z.enum(['active', 'pending_manual_quote', 'suspended']) });
platformRouter.post('/orgs/:id/billing-status', ownerOnly, async (req, res, next) => {
  try {
    const body = correctBillingStatusSchema.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    res.json(await platformService.correctBillingStatus(req.auth!.sub, req.params.id, body.data.status));
  } catch (err) {
    next(err);
  }
});

const pricingSchema = z.object({
  pricing_tier: z.enum(['starter', 'growth', 'scale', 'enterprise']).optional(),
  billing_frequency: z.enum(['monthly', 'per_cohort_cycle']).optional(),
  projected_students_per_year: z.number().int().min(0).nullable().optional(),
  is_enterprise_custom: z.boolean().optional(),
  custom_pricing_json: z.record(z.unknown()).nullable().optional(),
});
platformRouter.put('/orgs/:id/pricing', ownerOnly, async (req, res, next) => {
  try {
    const body = pricingSchema.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    res.json(await platformService.setOrgPricing(req.auth!.sub, req.params.id, body.data));
  } catch (err) {
    next(err);
  }
});

const settleSchema = z.object({ action: z.enum(['mark_paid', 'void']), note: z.string().max(300).optional() });
platformRouter.post('/invoices/:id/settle', ownerOnly, async (req, res, next) => {
  try {
    const body = settleSchema.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    res.json(await platformService.settleInvoice(req.auth!.sub, req.params.id, body.data.action, body.data.note));
  } catch (err) {
    next(err);
  }
});

// Runs the hourly billing job now (overdue marking, monthly invoices, tier
// re-evaluation, auto-finalising cohorts).
platformRouter.post('/billing/run', ownerOnly, async (_req, res, next) => {
  try {
    res.json(await platformService.runBillingNow());
  } catch (err) {
    next(err);
  }
});
