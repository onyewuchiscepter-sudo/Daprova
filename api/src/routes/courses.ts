import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { badRequest } from '../lib/errors.js';
import * as cohortService from '../services/cohortService.js';

export const coursesRouter = Router();
coursesRouter.use(requireAuth, requireRole('admin'));

function parse<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw badRequest('Invalid request body', result.error.flatten());
  return result.data;
}

const createCourseSchema = z.object({ name: z.string().min(1), category: z.string().min(1) });
coursesRouter.post('/', async (req, res, next) => {
  try {
    const body = parse(createCourseSchema, req.body);
    res.status(201).json(await cohortService.createCourse(req.auth!.org_id, body));
  } catch (err) {
    next(err);
  }
});

coursesRouter.get('/', async (req, res, next) => {
  try {
    res.json(await cohortService.listCourses(req.auth!.org_id));
  } catch (err) {
    next(err);
  }
});

coursesRouter.get('/:id', async (req, res, next) => {
  try {
    res.json(await cohortService.getCourse(req.auth!.org_id, req.params.id));
  } catch (err) {
    next(err);
  }
});

const createCohortSchema = z.object({
  name: z.string().min(1),
  framework_id: z.string().uuid(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  pass_threshold: z.number().min(0).max(100).optional(),
});
coursesRouter.post('/:id/cohorts', async (req, res, next) => {
  try {
    const body = parse(createCohortSchema, req.body);
    res.status(201).json(await cohortService.createCohort(req.auth!.org_id, req.auth!.sub, req.params.id, body));
  } catch (err) {
    next(err);
  }
});

coursesRouter.get('/:id/cohorts', async (req, res, next) => {
  try {
    res.json(await cohortService.listCohorts(req.auth!.org_id, req.params.id));
  } catch (err) {
    next(err);
  }
});
