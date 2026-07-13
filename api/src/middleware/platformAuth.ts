import type { NextFunction, Request, Response } from 'express';
import { db } from '../db/index.js';
import { forbidden, unauthorized } from '../lib/errors.js';

export type PlatformRole = 'support' | 'owner';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      platformAdmin?: { id: string; platform_role: PlatformRole };
    }
  }
}

// Platform-admin status is a property of the *person* (docs/org-onboarding-spec.md
// §7.1), independent of which org their current session happens to be
// scoped to — so this always does its own lookup rather than trusting
// anything in the session token itself. Must run after requireAuth.
export function requirePlatformRole(...roles: PlatformRole[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized());

    const admin = await db.selectFrom('platform_admins').selectAll().where('person_id', '=', req.auth.sub).executeTakeFirst();
    if (!admin) return next(forbidden('Platform admin access required'));
    if (!roles.includes(admin.platform_role as PlatformRole)) return next(forbidden(`Requires platform role: ${roles.join(' or ')}`));

    req.platformAdmin = { id: admin.id, platform_role: admin.platform_role as PlatformRole };
    next();
  };
}
