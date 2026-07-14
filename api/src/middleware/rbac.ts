import type { NextFunction, Request, Response } from 'express';
import { forbidden, unauthorized } from '../lib/errors.js';
import type { Role } from '@daprova/shared';

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized());
    // A platform-admin-only session (docs/org-onboarding-spec.md §7.1) has
    // no org_id/role at all — correctly rejected here like any other role
    // mismatch, since org-scoped routes aren't what that kind of session is for.
    if (!req.auth.role || !roles.includes(req.auth.role)) return next(forbidden(`Requires role: ${roles.join(' or ')}`));
    next();
  };
}
