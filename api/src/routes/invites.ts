import { Router } from 'express';
import { firebaseAuth } from '../lib/firebaseAdmin.js';
import { unauthorized } from '../lib/errors.js';
import { issueSession, REFRESH_COOKIE, refreshCookieOpts } from '../lib/sessionIssuance.js';
import * as orgTeamService from '../services/orgTeamService.js';

export const invitesRouter = Router();

// GET /api/v1/invites/:token — public, lets the accept-invite page show
// "join {org name} as {role}" before the person creates a password.
invitesRouter.get('/:token', async (req, res, next) => {
  try {
    res.json(await orgTeamService.getInvitePreview(req.params.token));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/invites/:token/accept — the invitee has just created their
// Firebase account client-side (or already has one from another org) and
// presents that fresh ID token here to link it to this org's membership.
// Issues a full session (session token + refresh cookie), same as any
// other login path, so they land straight in the dashboard.
invitesRouter.post('/:token/accept', async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized('Missing Firebase ID token');
    const idToken = header.slice('Bearer '.length);

    const decoded = await firebaseAuth.verifyIdToken(idToken).catch(() => {
      throw unauthorized('Invalid Firebase ID token');
    });
    if (!decoded.email) throw unauthorized('ID token missing email');

    const { org_id, person_id } = await orgTeamService.acceptInvite(req.params.token, decoded.uid, decoded.email, req.body?.display_name);

    const { sessionToken, refreshToken, person, membership } = await issueSession(person_id, org_id);
    res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOpts);
    res.json({
      session_token: sessionToken,
      user: { id: person.id, email: person.email, display_name: person.display_name, role: membership.role, org_id: membership.org_id },
    });
  } catch (err) {
    next(err);
  }
});
