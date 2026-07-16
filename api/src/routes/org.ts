import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { env } from '../env.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { requireVerified } from '../middleware/orgVerification.js';
import { badRequest, notFound } from '../lib/errors.js';
import * as orgTeamService from '../services/orgTeamService.js';

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
      logo_url: org.logo_url,
      contact_email: org.contact_email,
      verification_status: org.verification_status,
    });
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
