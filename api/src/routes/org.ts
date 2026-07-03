import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { notFound } from '../lib/errors.js';

export const orgRouter = Router();

// GET /api/v1/me — current user's profile, keyed off the session claims.
// Used by the admin-web client to restore full user info after a page
// refresh (the refresh-token flow only returns a new session JWT, not the
// user's email/display_name).
orgRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', req.auth!.sub)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!user) throw notFound('User not found');
    res.json({ id: user.id, email: user.email, display_name: user.display_name, role: user.role, org_id: user.org_id });
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
      .where('id', '=', req.auth!.org_id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!org) throw notFound('Organisation not found');
    res.json({ id: org.id, name: org.name, slug: org.slug, logo_url: org.logo_url, contact_email: org.contact_email });
  } catch (err) {
    next(err);
  }
});
