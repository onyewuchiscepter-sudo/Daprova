import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requirePlatformRole } from '../middleware/platformAuth.js';
import { badRequest, forbidden } from '../lib/errors.js';
import * as impersonationService from '../services/impersonationService.js';

export const impersonationRouter = Router();

// docs/org-onboarding-spec.md §7.3 — started from the platform admin's own
// normal session (support+owner, same gate as the rest of platform.ts).
const startSchema = z.object({ org_id: z.string().uuid(), person_id: z.string().uuid(), reason: z.string().min(1) });
impersonationRouter.post('/start', requireAuth, requirePlatformRole('support', 'owner'), async (req, res, next) => {
  try {
    const body = startSchema.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    const result = await impersonationService.startImpersonation(
      req.auth!.sub,
      req.platformAdmin!.platform_role,
      body.data.org_id,
      body.data.person_id,
      body.data.reason,
    );
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// Called using the IMPERSONATION token itself (req.auth.sub here is the
// target member, not the platform admin) — requireAuth's write-block
// middleware explicitly exempts this exact path (see middleware/auth.ts)
// so ending a read-only session isn't itself treated as a blocked write.
impersonationRouter.post('/end', requireAuth, async (req, res, next) => {
  try {
    if (!req.auth?.impersonation) throw forbidden('Not an impersonation session');
    await impersonationService.endImpersonation(req.auth.impersonation.platform_admin_person_id, req.auth.org_id!, req.auth.impersonation.session_id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
