import { Router } from 'express';
import { db } from '../db/index.js';
import { firebaseAuth } from '../lib/firebaseAdmin.js';
import { requireAuth } from '../middleware/auth.js';
import { unauthorized, notFound, badRequest, forbidden } from '../lib/errors.js';
import {
  newRefreshJti,
  signRefreshToken,
  signSessionToken,
  signOrgSelectionToken,
  verifyOrgSelectionToken,
  verifyRefreshToken,
  REFRESH_TOKEN_TTL_MS,
} from '../lib/sessionTokens.js';

export const authRouter = Router();

const REFRESH_COOKIE = 'daprova_refresh';
const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/api/v1/auth',
};

async function listMemberships(personId: string) {
  return db
    .selectFrom('org_memberships')
    .innerJoin('organisations', 'organisations.id', 'org_memberships.org_id')
    .select(['org_memberships.org_id', 'org_memberships.role', 'organisations.name as org_name'])
    .where('org_memberships.person_id', '=', personId)
    .where('org_memberships.deleted_at', 'is', null)
    .where('organisations.deleted_at', 'is', null)
    .execute();
}

// A session is always scoped to exactly one org membership — a person who
// belongs to more than one (docs/org-onboarding-spec.md §2) picks which via
// /auth/select-org or /auth/switch-org, but every issued session/refresh
// token pair remembers that choice explicitly (refresh_tokens.org_id),
// since it can no longer be derived implicitly from the person alone.
async function issueSession(personId: string, orgId: string) {
  const person = await db.selectFrom('people').selectAll().where('id', '=', personId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!person) throw notFound('Person not found');

  const membership = await db
    .selectFrom('org_memberships')
    .selectAll()
    .where('person_id', '=', personId)
    .where('org_id', '=', orgId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!membership) throw forbidden('Not a member of that organisation');

  const sessionToken = signSessionToken({ sub: person.id, org_id: membership.org_id, role: membership.role as 'admin' | 'viewer' });

  const jti = newRefreshJti();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  await db.insertInto('refresh_tokens').values({ person_id: person.id, org_id: membership.org_id, jti, expires_at: expiresAt }).execute();
  const refreshToken = signRefreshToken(person.id, jti);

  return { sessionToken, refreshToken, jti, person, membership };
}

// B5.1 steps 3-6: verify the Firebase/emulator-issued ID token, then issue our own
// short-lived session token + rotated refresh token — unless the person belongs
// to more than one org, in which case they pick one via /auth/select-org first.
authRouter.post('/verify', async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized('Missing Firebase ID token');
    const idToken = header.slice('Bearer '.length);

    const decoded = await firebaseAuth.verifyIdToken(idToken).catch(() => {
      throw unauthorized('Invalid Firebase ID token');
    });

    const person = await db
      .selectFrom('people')
      .selectAll()
      .where('auth_uid', '=', decoded.uid)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!person) throw notFound('No Daprova account provisioned for this login');

    const memberships = await listMemberships(person.id);
    if (memberships.length === 0) throw notFound('No organisation membership for this account');

    await db.updateTable('people').set({ last_login_at: new Date() }).where('id', '=', person.id).execute();

    if (memberships.length > 1) {
      res.json({
        requires_org_selection: true,
        org_selection_token: signOrgSelectionToken(person.id),
        orgs: memberships.map((m) => ({ id: m.org_id, name: m.org_name, role: m.role })),
      });
      return;
    }

    const { sessionToken, refreshToken } = await issueSession(person.id, memberships[0].org_id);
    res.cookie(REFRESH_COOKIE, refreshToken, cookieOpts);
    res.json({
      session_token: sessionToken,
      user: { id: person.id, email: person.email, display_name: person.display_name, role: memberships[0].role, org_id: memberships[0].org_id },
    });
  } catch (err) {
    next(err);
  }
});

// Completes login for a person with more than one org membership — takes
// the short-lived token from /auth/verify (proves Firebase already
// succeeded, without re-verifying it) plus their chosen org.
authRouter.post('/select-org', async (req, res, next) => {
  try {
    const orgSelectionToken = req.body?.org_selection_token;
    const orgId = req.body?.org_id;
    if (!orgSelectionToken || !orgId) throw badRequest('Missing org_selection_token or org_id');

    const { sub: personId } = await Promise.resolve(verifyOrgSelectionToken(orgSelectionToken)).catch(() => {
      throw unauthorized('Invalid or expired org selection token');
    });

    const { sessionToken, refreshToken, person, membership } = await issueSession(personId, orgId);
    res.cookie(REFRESH_COOKIE, refreshToken, cookieOpts);
    res.json({
      session_token: sessionToken,
      user: { id: person.id, email: person.email, display_name: person.display_name, role: membership.role, org_id: membership.org_id },
    });
  } catch (err) {
    next(err);
  }
});

// Re-issues a session scoped to a different org the same signed-in person
// belongs to, without going back through Firebase — the org-switcher's
// backend counterpart (docs/org-onboarding-spec.md §2).
authRouter.post('/switch-org', requireAuth, async (req, res, next) => {
  try {
    const orgId = req.body?.org_id;
    if (!orgId) throw badRequest('Missing org_id');

    const { sessionToken, refreshToken, person, membership } = await issueSession(req.auth!.sub, orgId);
    res.cookie(REFRESH_COOKIE, refreshToken, cookieOpts);
    res.json({
      session_token: sessionToken,
      user: { id: person.id, email: person.email, display_name: person.display_name, role: membership.role, org_id: membership.org_id },
    });
  } catch (err) {
    next(err);
  }
});

// Grace window for a refresh token presented again just after it was
// rotated away — covers React 18 StrictMode double-invoking the
// restore-on-mount effect in dev, and two browser tabs refreshing at
// nearly the same moment in production. Without this, whichever of the two
// near-simultaneous requests loses the race gets a hard 401 and the person
// is bounced to the login screen despite having done nothing wrong.
const REFRESH_REUSE_GRACE_MS = 10_000;

authRouter.post('/refresh', async (req, res, next) => {
  try {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw unauthorized('Missing refresh token');

    const { jti } = await Promise.resolve(verifyRefreshToken(token)).catch(() => {
      throw unauthorized('Invalid refresh token');
    });

    let stored = await db.selectFrom('refresh_tokens').selectAll().where('jti', '=', jti).executeTakeFirst();
    if (!stored) throw unauthorized('Refresh token no longer valid');

    // Follow the replaced_by_jti chain until an unrevoked row is found —
    // a single race can chain two or more hops deep (e.g. two concurrent
    // requests each independently rotate the same presented token, and a
    // third, slightly later request needs to walk through both to reach
    // the currently-live token), not just one.
    const MAX_CHAIN_HOPS = 5;
    for (let hops = 0; stored.revoked_at && hops < MAX_CHAIN_HOPS; hops++) {
      const revokedMsAgo = Date.now() - new Date(stored.revoked_at as unknown as string).getTime();
      const withinGrace = stored.replaced_by_jti && revokedMsAgo >= 0 && revokedMsAgo < REFRESH_REUSE_GRACE_MS;
      if (!withinGrace) throw unauthorized('Refresh token no longer valid');

      const successor = await db.selectFrom('refresh_tokens').selectAll().where('jti', '=', stored.replaced_by_jti!).executeTakeFirst();
      if (!successor) throw unauthorized('Refresh token no longer valid');
      stored = successor;
    }
    if (stored.revoked_at) throw unauthorized('Refresh token no longer valid');

    if (new Date(stored.expires_at as unknown as string) < new Date()) {
      throw unauthorized('Refresh token no longer valid');
    }

    // Rotation: issue the new token first, then link the presented one to
    // it — so a duplicate request arriving in between sees a fully-formed
    // (revoked_at + replaced_by_jti) row rather than a window where it's
    // revoked but not yet linked to anything.
    const { sessionToken, refreshToken, jti: newJti } = await issueSession(stored.person_id, stored.org_id);
    await db.updateTable('refresh_tokens').set({ revoked_at: new Date(), replaced_by_jti: newJti }).where('id', '=', stored.id).execute();
    res.cookie(REFRESH_COOKIE, refreshToken, cookieOpts);
    res.json({ session_token: sessionToken });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', async (req, res, next) => {
  try {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (token) {
      try {
        const { jti } = verifyRefreshToken(token);
        await db.updateTable('refresh_tokens').set({ revoked_at: new Date() }).where('jti', '=', jti).execute();
      } catch {
        // already invalid/expired — nothing to revoke
      }
    }
    res.clearCookie(REFRESH_COOKIE, { path: cookieOpts.path });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
