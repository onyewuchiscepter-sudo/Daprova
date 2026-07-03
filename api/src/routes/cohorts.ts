import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { badRequest } from '../lib/errors.js';
import * as cohortService from '../services/cohortService.js';
import * as analyticsService from '../services/analyticsService.js';
import * as dataQualityService from '../services/dataQualityService.js';

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

// GET /api/v1/cohorts/:id/dashboard — B3.5's "full cohort analytics dashboard
// data": mean gain, Cohen's d, and the competency-level breakdown together.
cohortsRouter.get('/:id/dashboard', async (req, res, next) => {
  try {
    const cohort = await cohortService.getCohort(req.auth!.org_id, req.params.id);
    const passThreshold = Number(cohort.pass_threshold);
    const [gains, effectSize, competencyBreakdown, passRate] = await Promise.all([
      analyticsService.getMeanGain(cohort.id),
      analyticsService.getCohensD(cohort.id),
      analyticsService.getCompetencyBreakdown(cohort.id, cohort.framework_id),
      analyticsService.getPassRate(cohort.id, passThreshold),
    ]);
    res.json({ ...gains, cohens_d: effectSize.cohens_d, pass_threshold: passThreshold, pass_rate: passRate, competency_breakdown: competencyBreakdown });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/cohorts/:id/equity — Module 3, all four demographic dimensions
// in one response rather than one call per dimension.
cohortsRouter.get('/:id/equity', async (req, res, next) => {
  try {
    const cohort = await cohortService.getCohort(req.auth!.org_id, req.params.id);
    const dimensions = ['gender', 'age_group', 'location_type', 'disability'] as const;
    const breakdowns = await Promise.all(dimensions.map((d) => analyticsService.getEquityBreakdown(cohort.id, d)));
    res.json(breakdowns);
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/cohorts/:id/run-outlier-detection — admin-triggered stand-in
// for the spec's "background job after cohort closes" (no task-queue infra
// in this MVP to schedule it automatically).
cohortsRouter.post('/:id/run-outlier-detection', async (req, res, next) => {
  try {
    const cohort = await cohortService.getCohort(req.auth!.org_id, req.params.id);
    res.json(await dataQualityService.runOutlierDetection(cohort.id));
  } catch (err) {
    next(err);
  }
});
