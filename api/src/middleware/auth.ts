import type { NextFunction, Request, Response } from 'express';
import { verifySessionToken } from '../lib/sessionTokens.js';
import { unauthorized, forbidden } from '../lib/errors.js';
import { writeAuditLog } from '../lib/auditLog.js';
import { db } from '../db/index.js';
import type { SessionClaims } from '@daprova/shared';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: SessionClaims;
    }
  }
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// The one write every impersonation session must still be able to make,
// regardless of mode — ending itself. Checked by exact path so ending an
// impersonation is never itself treated as a blocked/logged write.
const IMPERSONATION_END_PATH = '/api/v1/impersonation/end';

// docs/org-onboarding-spec.md §7.3 point 3/6 — this is the one chokepoint
// every org-scoped router already runs its first middleware through, so
// impersonation's write-blocking and per-write logging live here rather
// than as a separate middleware every router would need to remember to add.
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(unauthorized('Missing bearer token'));

  let claims: SessionClaims;
  try {
    claims = verifySessionToken(header.slice('Bearer '.length));
  } catch {
    return next(unauthorized('Invalid or expired session token'));
  }
  const impersonation = claims.impersonation;
  const isEndingImpersonation = req.originalUrl.split('?')[0] === IMPERSONATION_END_PATH;

  // A session token lasts 24h (impersonation: 30m), so what it says can go
  // stale. Re-check the facts it vouches for on every request, so that
  // ending an impersonation, suspending/closing an org, removing a member or
  // changing their role takes effect immediately rather than at expiry.
  try {
    if (impersonation && !isEndingImpersonation) {
      const session = await db
        .selectFrom('impersonation_sessions')
        .select('id')
        .where('id', '=', impersonation.session_id)
        .where('ended_at', 'is', null)
        .where('expires_at', '>', new Date())
        .executeTakeFirst();
      if (!session) return next(unauthorized('This impersonation session has ended'));
    }
    // Switching org and ending an impersonation must still work when the
    // current org is the thing that changed (switch-org re-checks the org
    // it switches to).
    if (claims.org_id && !isEndingImpersonation && req.originalUrl.split('?')[0] !== '/api/v1/auth/switch-org') {
      const membership = await db
        .selectFrom('org_memberships')
        .innerJoin('organisations', 'organisations.id', 'org_memberships.org_id')
        .innerJoin('people', 'people.id', 'org_memberships.person_id')
        .select(['org_memberships.role', 'organisations.billing_status'])
        .where('org_memberships.person_id', '=', claims.sub)
        .where('org_memberships.org_id', '=', claims.org_id)
        .where('org_memberships.deleted_at', 'is', null)
        .where('organisations.deleted_at', 'is', null)
        .where('people.deleted_at', 'is', null)
        .executeTakeFirst();
      if (!membership) return next(unauthorized('You no longer have access to this organisation — please sign in again'));
      if (membership.billing_status === 'suspended') return next(forbidden('This organisation has been suspended'));
      // The role as it is now, not as it was when the token was issued.
      claims = { ...claims, role: membership.role as SessionClaims['role'] };
    }
  } catch (err) {
    return next(err);
  }
  req.auth = claims;

  const isMutating = WRITE_METHODS.has(req.method);
  if (impersonation && isMutating && !isEndingImpersonation) {
    if (impersonation.mode === 'read_only') {
      return next(forbidden('This is a read-only impersonation session — writes are not permitted'));
    }
    // write-mode: every mutating request is individually logged (not just
    // start/end) — reconstructing "what exactly did they change" is the
    // whole point of this being the one path with real write access.
    try {
      await writeAuditLog({
        actorPersonId: impersonation.platform_admin_person_id,
        actorContext: 'impersonating',
        orgId: claims.org_id,
        action: 'impersonated_write',
        details: { impersonation_session_id: impersonation.session_id, method: req.method, path: req.originalUrl, body: req.body },
      });
    } catch (err) {
      console.error('[audit] failed to log impersonated write', err);
    }
  }

  next();
}
