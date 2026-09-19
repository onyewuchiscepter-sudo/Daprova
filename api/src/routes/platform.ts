import { Router, type NextFunction, type Request, type Response } from 'express';
import { db } from '../db/index.js';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requirePlatformRole } from '../middleware/platformAuth.js';
import { badRequest } from '../lib/errors.js';
import * as platformService from '../services/platformService.js';
import * as ops from '../services/platformOpsService.js';
import { reconcilePendingPayments } from '../services/paymentService.js';
import { providerStatus } from '../services/payments/index.js';

export const platformRouter = Router();
platformRouter.use(requireAuth, requirePlatformRole('support', 'owner'));

// Re-applying requirePlatformRole on a route (rather than relying only on
// the router-level support+owner gate above) is what narrows it to owners:
// support can view, verify and review, but not change money, status,
// accounts or staff.
const ownerOnly = requirePlatformRole('owner');

// Every status or money change says why; the reason goes into the activity
// log next to what changed.
const reasonField = z.string().trim().min(3, 'Give a reason (at least 3 characters)').max(300);
const withReason = z.object({ reason: reasonField });
function reasonOf(body: unknown) {
  const r = withReason.safeParse(body);
  if (!r.success) throw badRequest('A reason is required for this action', r.error.flatten());
  return r.data.reason;
}

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
  admin_password: z.string().min(8).optional(),
});
platformRouter.post('/orgs', ownerOnly, async (req, res, next) => {
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
        .leftJoin('invoices', 'invoices.id', 'payments.invoice_id')
        .select(['payments.reference', 'payments.amount', 'payments.status', 'payments.provider', 'payments.purpose', 'payments.created_at', 'payments.paid_at', 'payments.failure_reason', 'organisations.name as org_name', 'invoices.invoice_number'])
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

// docs/org-onboarding-spec.md §7.2 — org regulation, money and staff are
// `owner`-only (ownerOnly, defined at the top of this file).

platformRouter.post('/orgs/:id/suspend', ownerOnly, async (req, res, next) => {
  try {
    res.json(await platformService.suspendOrg(req.auth!.sub, req.params.id, reasonOf(req.body)));
  } catch (err) {
    next(err);
  }
});

platformRouter.post('/orgs/:id/reactivate', ownerOnly, async (req, res, next) => {
  try {
    res.json(await platformService.reactivateOrg(req.auth!.sub, req.params.id, reasonOf(req.body)));
  } catch (err) {
    next(err);
  }
});

platformRouter.post('/orgs/:id/close', ownerOnly, async (req, res, next) => {
  try {
    res.json(await platformService.closeOrg(req.auth!.sub, req.params.id, reasonOf(req.body)));
  } catch (err) {
    next(err);
  }
});

platformRouter.post('/orgs/:id/ban', ownerOnly, async (req, res, next) => {
  try {
    res.json(await platformService.banOrg(req.auth!.sub, req.params.id, reasonOf(req.body)));
  } catch (err) {
    next(err);
  }
});

platformRouter.post('/orgs/:id/extend-free-trial', ownerOnly, async (req, res, next) => {
  try {
    res.json(await platformService.extendFreeTrial(req.auth!.sub, req.params.id, reasonOf(req.body)));
  } catch (err) {
    next(err);
  }
});

const correctBillingStatusSchema = z.object({ status: z.enum(['active', 'pending_manual_quote', 'suspended']), reason: reasonField });
platformRouter.post('/orgs/:id/billing-status', ownerOnly, async (req, res, next) => {
  try {
    const body = correctBillingStatusSchema.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    res.json(await platformService.correctBillingStatus(req.auth!.sub, req.params.id, body.data.status, body.data.reason));
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
  reason: reasonField,
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

// The note is the reason: e.g. the bank-transfer reference, or why it's written off.
const settleSchema = z.object({ action: z.enum(['mark_paid', 'void']), note: reasonField });
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

// ---- Platform operations (services/platformOpsService). Reads are open to
// support and owner; anything that changes money, staff or accounts is
// owner-only, like the org actions above.
type Handler = (req: Request) => Promise<unknown>;
const handle = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json((await fn(req)) ?? { ok: true });
  } catch (err) {
    next(err);
  }
};
function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw badRequest('Invalid request body', r.error.flatten());
  return r.data;
}

platformRouter.get('/me', handle((req) => ops.me(req.auth!.sub)));
platformRouter.get('/overview', handle(() => ops.overview()));

platformRouter.get(
  '/invoices',
  handle((req) =>
    ops.listAllInvoices({
      status: typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined,
      q: typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : undefined,
    }),
  ),
);
const amountReason = z.object({ amount: z.number().finite(), reason: z.string().trim().min(3).max(200) });
platformRouter.post('/invoices/:id/discount', ownerOnly, handle((req) => {
  const b = parse(amountReason, req.body);
  return ops.discountInvoice(req.auth!.sub, req.params.id, b.amount, b.reason);
}));
platformRouter.post('/invoices/:id/remind', handle((req) => ops.remindInvoice(req.auth!.sub, req.params.id)));
platformRouter.post('/orgs/:id/credit', ownerOnly, handle((req) => {
  const b = parse(amountReason, req.body);
  return ops.adjustCredit(req.auth!.sub, req.params.id, b.amount, b.reason);
}));

platformRouter.get('/admins', handle(() => ops.listPlatformAdmins()));
platformRouter.post('/admins', ownerOnly, handle((req) =>
  ops.addPlatformAdmin(req.auth!.sub, parse(z.object({ email: z.string().email(), role: z.enum(['support', 'owner']), display_name: z.string().trim().max(120).optional() }), req.body)),
));
platformRouter.put('/admins/:id', ownerOnly, handle((req) => ops.changePlatformRole(req.auth!.sub, req.params.id, parse(z.object({ role: z.enum(['support', 'owner']) }), req.body).role)));
platformRouter.delete('/admins/:id', ownerOnly, handle((req) => ops.removePlatformAdmin(req.auth!.sub, req.params.id)));

platformRouter.get(
  '/activity',
  handle((req) => {
    const s = (k: string) => (typeof req.query[k] === 'string' && (req.query[k] as string).trim() ? (req.query[k] as string).trim() : undefined);
    const orgId = s('org_id');
    if (orgId && !z.string().uuid().safeParse(orgId).success) throw badRequest('Invalid org_id');
    const before = s('before');
    if (before && Number.isNaN(Date.parse(before))) throw badRequest('Invalid before');
    return ops.activityLog({ org_id: orgId, action: s('action'), actor: s('actor'), before });
  }),
);

platformRouter.patch('/orgs/:id', ownerOnly, handle((req) =>
  ops.updateOrgProfile(req.auth!.sub, req.params.id, parse(z.object({ name: z.string().trim().min(1).max(200).optional(), contact_email: z.string().email().optional() }), req.body)),
));
platformRouter.post('/orgs/:id/reopen', ownerOnly, handle((req) => ops.reopenOrg(req.auth!.sub, req.params.id, reasonOf(req.body))));
platformRouter.put('/orgs/:id/members/:membershipId', ownerOnly, handle((req) =>
  ops.setMemberRole(req.auth!.sub, req.params.id, req.params.membershipId, parse(z.object({ role: z.enum(['admin', 'viewer']) }), req.body).role),
));
platformRouter.delete('/orgs/:id/members/:membershipId', ownerOnly, handle((req) => ops.removeOrgMember(req.auth!.sub, req.params.id, req.params.membershipId)));
platformRouter.post('/orgs/:id/members/:membershipId/password-reset', handle((req) => ops.sendMemberPasswordReset(req.auth!.sub, req.params.id, req.params.membershipId)));
platformRouter.get('/orgs/:id/invites', handle((req) => ops.listOrgInvites(req.params.id)));
platformRouter.post('/orgs/:id/invites', ownerOnly, handle((req) =>
  ops.inviteToOrg(req.auth!.sub, req.params.id, parse(z.object({ email: z.string().email(), role: z.enum(['admin', 'viewer']) }), req.body)),
));
platformRouter.post('/orgs/:id/invites/:inviteId/resend', handle((req) => ops.resendInvite(req.auth!.sub, req.params.id, req.params.inviteId)));
platformRouter.delete('/orgs/:id/invites/:inviteId', ownerOnly, handle((req) => ops.revokeInvite(req.auth!.sub, req.params.id, req.params.inviteId)));

platformRouter.get('/announcements', handle(() => ops.listAnnouncements()));
platformRouter.post('/announcements', ownerOnly, handle((req) =>
  ops.createAnnouncement(
    req.auth!.sub,
    parse(
      z.object({
        title: z.string().trim().min(3).max(160),
        body: z.string().trim().min(3).max(4000),
        level: z.enum(['info', 'warning']),
        audience: z.enum(['all', 'tier', 'org']),
        audience_tier: z.enum(['starter', 'growth', 'scale', 'enterprise']).nullable().optional(),
        audience_org_id: z.string().uuid().nullable().optional(),
        starts_at: z.string().datetime({ offset: true }).nullable().optional(),
        ends_at: z.string().datetime({ offset: true }).nullable().optional(),
        send_email: z.boolean().optional(),
      }),
      req.body,
    ),
  ),
));
platformRouter.post('/announcements/:id/end', ownerOnly, handle((req) => ops.endAnnouncement(req.auth!.sub, req.params.id)));
