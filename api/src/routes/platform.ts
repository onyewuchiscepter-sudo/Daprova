import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requirePlatformRole } from '../middleware/platformAuth.js';
import { badRequest } from '../lib/errors.js';
import * as platformService from '../services/platformService.js';
import { reconcilePendingPayments } from '../services/paymentService.js';

export const platformRouter = Router();
platformRouter.use(requireAuth, requirePlatformRole('support', 'owner'));

platformRouter.get('/orgs', async (req, res, next) => {
  try {
    res.json(await platformService.listOrgs());
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

platformRouter.post('/orgs/:id/extend-free-trial', ownerOnly, async (req, res, next) => {
  try {
    res.json(await platformService.extendFreeTrial(req.auth!.sub, req.params.id));
  } catch (err) {
    next(err);
  }
});

const correctBillingStatusSchema = z.object({ status: z.enum(['active', 'locked_pending_upgrade', 'pending_manual_quote', 'suspended']) });
platformRouter.post('/orgs/:id/billing-status', ownerOnly, async (req, res, next) => {
  try {
    const body = correctBillingStatusSchema.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    res.json(await platformService.correctBillingStatus(req.auth!.sub, req.params.id, body.data.status));
  } catch (err) {
    next(err);
  }
});

const overrideTierSchema = z.object({ cohort_id: z.string().uuid(), new_tier: z.string().min(1) });
platformRouter.post('/orgs/:id/override-tier', ownerOnly, async (req, res, next) => {
  try {
    const body = overrideTierSchema.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    res.json(await platformService.overrideCohortTier(req.auth!.sub, req.params.id, body.data.cohort_id, body.data.new_tier));
  } catch (err) {
    next(err);
  }
});
