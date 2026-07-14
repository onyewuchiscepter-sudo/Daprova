import type { NextFunction, Request, Response } from 'express';
import { verifySessionToken } from '../lib/sessionTokens.js';
import { unauthorized, forbidden } from '../lib/errors.js';
import { writeAuditLog } from '../lib/auditLog.js';
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
  req.auth = claims;

  const impersonation = claims.impersonation;
  const isMutating = WRITE_METHODS.has(req.method);
  if (impersonation && isMutating && req.originalUrl.split('?')[0] !== IMPERSONATION_END_PATH) {
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
