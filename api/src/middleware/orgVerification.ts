import type { NextFunction, Request, Response } from 'express';
import { db } from '../db/index.js';
import { forbidden, unauthorized } from '../lib/errors.js';

// docs/org-onboarding-spec.md — self-serve (Model A) signups start
// verification_status='pending' and stay that way until a platform admin
// reviews the registration. Pending orgs can still use the actual product
// (frameworks/courses/cohorts) — this middleware only guards the handful of
// team-management routes (invite/role-change/remove/org-profile-edit) that
// would let a still-unverified org grow before it's been vetted. Must run
// after requireAuth.
export async function requireVerified(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (!req.auth?.org_id) return next(unauthorized());

  const org = await db.selectFrom('organisations').select(['verification_status']).where('id', '=', req.auth.org_id).executeTakeFirst();
  if (org?.verification_status === 'pending') {
    return next(forbidden('Your organisation is awaiting verification — team management is unavailable until this is reviewed'));
  }
  next();
}
