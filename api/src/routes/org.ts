import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { env } from '../env.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { requireVerified } from '../middleware/orgVerification.js';
import { badRequest, notFound } from '../lib/errors.js';
import * as orgTeamService from '../services/orgTeamService.js';
import * as insightsService from '../services/insightsService.js';
import { orgLogoPath, parseBrandColor, parseLogoDataUrl } from '../lib/branding.js';
import { sql } from 'kysely';
import { activeAnnouncementsForOrg } from '../services/platformOpsService.js';
import { getOrgPlan, isTierLocked } from '../services/billing/plan.js';

export const orgRouter = Router();

// GET /api/v1/me — current person's profile *within their active session's
// org* (role is per-membership, not per-person, since a person can belong
// to more than one org — docs/org-onboarding-spec.md §2). Used by the
// admin-web client to restore full user info after a page refresh (the
// refresh-token flow only returns a new session JWT, not the person's
// email/display_name).
orgRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const row = await db
      .selectFrom('people')
      .innerJoin('org_memberships', 'org_memberships.person_id', 'people.id')
      .select(['people.id', 'people.email', 'people.display_name', 'org_memberships.role', 'org_memberships.org_id'])
      .where('people.id', '=', req.auth!.sub)
      .where('people.deleted_at', 'is', null)
      .where('org_memberships.org_id', '=', req.auth!.org_id!)
      .where('org_memberships.deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row) throw notFound('User not found');
    res.json(row);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/org — minimal profile fetch, mainly here in S1 to prove the
// end-to-end auth flow (login -> session token -> authenticated request) works.
orgRouter.get('/org', requireAuth, async (req, res, next) => {
  try {
    const org = await db
      .selectFrom('organisations')
      .selectAll()
      .where('id', '=', req.auth!.org_id!)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!org) throw notFound('Organisation not found');
    res.json({
      id: org.id,
      name: org.name,
      slug: org.slug,
      logo_url: org.logo_data ? orgLogoPath(org.id, org.logo_updated_at as unknown as string) : org.logo_url,
      brand_color: org.brand_color,
      contact_email: org.contact_email,
      verification_status: org.verification_status,
    });
  } catch (err) {
    next(err);
  }
});

// The org's current plan, for every member (not just admins). The app polls
// this so a plan change made by Daprova shows up on an open dashboard within
// seconds; `version` changes whenever the plan or its features do.
orgRouter.get('/org/plan', requireAuth, async (req, res, next) => {
  try {
    if (!req.auth!.org_id) throw notFound('No organisation');
    const { org, tier } = await getOrgPlan(req.auth!.org_id);
    res.set('Cache-Control', 'no-store').json({
      tier_id: tier.tier_id,
      name: tier.display_name,
      features: tier.features,
      concurrent_cohorts_limit: tier.concurrent_cohorts_limit,
      locked: isTierLocked(org),
      version: crypto.createHash('sha1').update(JSON.stringify([org.pricing_tier, org.tier_effective_date, org.is_enterprise_custom, org.custom_pricing_json, tier.features])).digest('hex').slice(0, 16),
    });
  } catch (err) {
    next(err);
  }
});

// Notices from Daprova (platform console → Announcements) for this org.
orgRouter.get('/org/announcements', requireAuth, async (req, res, next) => {
  try {
    res.json(req.auth!.org_id ? await activeAnnouncementsForOrg(req.auth!.org_id) : []);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/org/memberships — every org the current signed-in person
// belongs to, for the org-switcher UI (docs/org-onboarding-spec.md §2).
orgRouter.get('/org/memberships', requireAuth, async (req, res, next) => {
  try {
    const rows = await db
      .selectFrom('org_memberships')
      .innerJoin('organisations', 'organisations.id', 'org_memberships.org_id')
      .select(['organisations.id', 'organisations.name', 'org_memberships.role'])
      .where('org_memberships.person_id', '=', req.auth!.sub)
      .where('org_memberships.deleted_at', 'is', null)
      .where('organisations.deleted_at', 'is', null)
      .orderBy('organisations.name')
      .execute();
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/org — update org name/logo/contact email
// (docs/org-onboarding-spec.md §6, spec'd in the original PRD's B3.3).
const updateOrgSchema = z.object({
  name: z.string().min(1).optional(),
  logo_url: z.string().url().optional(),
  contact_email: z.string().email().optional(),
});
orgRouter.patch('/org', requireAuth, requireRole('admin'), requireVerified, async (req, res, next) => {
  try {
    const body = updateOrgSchema.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    const org = await orgTeamService.updateOrgProfile(req.auth!.org_id!, body.data);
    res.json({ id: org.id, name: org.name, slug: org.slug, logo_url: org.logo_url, contact_email: org.contact_email });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/org/overview — the home dashboard: totals across every
// cohort, per-cohort numbers, and what needs attention.
orgRouter.get('/org/overview', requireAuth, async (req, res, next) => {
  try {
    res.json(await insightsService.orgOverview(req.auth!.org_id!));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/org/branding — the org's own logo and accent colour. Stored
// for every org; applied to a cohort's reports, assessment pages and
// certificates only when that cohort's tier includes custom_branding
// (lib/branding.ts). logo: a PNG/JPEG data URL, or null to remove it.
const brandingSchema = z.object({
  brand_color: z.string().nullable().optional(),
  logo: z.string().nullable().optional(),
});
orgRouter.put('/org/branding', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const body = brandingSchema.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    const set: Record<string, unknown> = { updated_at: sql`now()` };
    if (body.data.brand_color !== undefined) set.brand_color = body.data.brand_color === null ? null : parseBrandColor(body.data.brand_color);
    if (body.data.logo !== undefined) {
      const logo = body.data.logo === null ? null : parseLogoDataUrl(body.data.logo);
      Object.assign(set, { logo_data: logo?.data ?? null, logo_mime: logo?.mime ?? null, logo_updated_at: sql`now()` });
    }
    const org = await db
      .updateTable('organisations')
      .set(set)
      .where('id', '=', req.auth!.org_id!)
      .returning(['id', 'brand_color', 'logo_updated_at', 'logo_mime'])
      .executeTakeFirstOrThrow();
    res.json({
      brand_color: org.brand_color,
      logo_url: org.logo_mime ? orgLogoPath(org.id, org.logo_updated_at as unknown as string) : null,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/org/users — every active member plus every pending invite,
// for the Team/Settings page (docs/org-onboarding-spec.md §3, §6).
orgRouter.get('/org/users', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const [members, pendingInvites] = await Promise.all([
      orgTeamService.listMembers(req.auth!.org_id!),
      orgTeamService.listPendingInvites(req.auth!.org_id!),
    ]);
    res.json({ members, pending_invites: pendingInvites });
  } catch (err) {
    next(err);
  }
});

const inviteSchema = z.object({ email: z.string().email(), role: z.enum(['admin', 'viewer']) });
orgRouter.post('/org/users/invite', requireAuth, requireRole('admin'), requireVerified, async (req, res, next) => {
  try {
    const body = inviteSchema.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());

    const [org, inviter] = await Promise.all([
      db.selectFrom('organisations').select('name').where('id', '=', req.auth!.org_id!).executeTakeFirstOrThrow(),
      db.selectFrom('people').select('email').where('id', '=', req.auth!.sub).executeTakeFirstOrThrow(),
    ]);

    await orgTeamService.inviteMember(
      req.auth!.org_id!,
      req.auth!.sub,
      org.name,
      inviter.email,
      body.data,
      `${env.adminDashboardOrigin}/accept-invite`,
    );
    res.status(201).json({ email: body.data.email, role: body.data.role });
  } catch (err) {
    next(err);
  }
});

const roleSchema = z.object({ role: z.enum(['admin', 'viewer']) });
orgRouter.patch('/org/users/:id/role', requireAuth, requireRole('admin'), requireVerified, async (req, res, next) => {
  try {
    const body = roleSchema.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    const membership = await orgTeamService.changeRole(req.auth!.org_id!, req.params.id, body.data.role, req.auth!.sub);
    res.json({ id: membership.id, role: membership.role });
  } catch (err) {
    next(err);
  }
});

orgRouter.delete('/org/users/:id', requireAuth, requireRole('admin'), requireVerified, async (req, res, next) => {
  try {
    await orgTeamService.removeMember(req.auth!.org_id!, req.params.id, req.auth!.sub);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
