import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { badRequest } from '../lib/errors.js';
import * as cohortService from '../services/cohortService.js';

export const cohortsRouter = Router();
cohortsRouter.use(requireAuth, requireRole('admin'));

function parse<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw badRequest('Invalid request body', result.error.flatten());
  return result.data;
}

cohortsRouter.get('/:id', async (req, res, next) => {
  try {
    res.json(await cohortService.getCohort(req.auth!.org_id, req.params.id));
  } catch (err) {
    next(err);
  }
});

const updateCohortSchema = z.object({
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  graduation_date: z.string().optional(),
  status: z.enum(['setup', 'active', 'graduated', 'closed']).optional(),
});
cohortsRouter.patch('/:id', async (req, res, next) => {
  try {
    const body = parse(updateCohortSchema, req.body);
    res.json(await cohortService.updateCohort(req.auth!.org_id, req.params.id, body));
  } catch (err) {
    next(err);
  }
});

cohortsRouter.get('/:id/learners', async (req, res, next) => {
  try {
    res.json(await cohortService.listCohortLearners(req.auth!.org_id, req.params.id));
  } catch (err) {
    next(err);
  }
});

const regenerateLinkSchema = z.object({ type: z.enum(['pre', 'post']) });
cohortsRouter.post('/:id/regenerate-link', async (req, res, next) => {
  try {
    const body = parse(regenerateLinkSchema, req.body);
    res.json(await cohortService.regenerateLinkToken(req.auth!.org_id, req.params.id, body.type));
  } catch (err) {
    next(err);
  }
});
