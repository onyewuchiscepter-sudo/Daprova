import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requirePlatformRole } from '../middleware/platformAuth.js';
import { badRequest } from '../lib/errors.js';
import * as platformService from '../services/platformService.js';

export const platformRouter = Router();
platformRouter.use(requireAuth, requirePlatformRole('support', 'owner'));

platformRouter.get('/orgs', async (req, res, next) => {
  try {
    res.json(await platformService.listOrgs());
  } catch (err) {
    next(err);
  }
});

platformRouter.get('/orgs/:id', async (req, res, next) => {
  try {
    res.json(await platformService.getOrgDetail(req.params.id));
  } catch (err) {
    next(err);
  }
});

const createOrgSchema = z.object({
  org_name: z.string().min(1),
  org_slug: z.string().min(1),
  contact_email: z.string().email(),
  admin_email: z.string().email(),
  admin_display_name: z.string().optional(),
  admin_password: z.string().min(8),
});
platformRouter.post('/orgs', async (req, res, next) => {
  try {
    const body = createOrgSchema.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    const result = await platformService.createOrgWithAdmin(req.auth!.sub, body.data);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

platformRouter.get('/fraud-flags', async (_req, res, next) => {
  try {
    res.json(await platformService.listFraudFlags());
  } catch (err) {
    next(err);
  }
});

const reviewFraudFlagSchema = z.object({ decision: z.enum(['approved', 'rejected']) });
platformRouter.post('/fraud-flags/:id/review', async (req, res, next) => {
  try {
    const body = reviewFraudFlagSchema.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    res.json(await platformService.reviewFraudFlag(req.auth!.sub, req.params.id, body.data.decision));
  } catch (err) {
    next(err);
  }
});
