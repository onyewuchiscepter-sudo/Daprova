import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { badRequest } from '../lib/errors.js';
import * as cohortService from '../services/cohortService.js';
import * as frameworkService from '../services/frameworkService.js';
import * as insightsService from '../services/insightsService.js';
import * as billing from '../services/billing/index.js';

export const coursesRouter = Router();
coursesRouter.use(requireAuth, requireRole('admin'));

function parse<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw badRequest('Invalid request body', result.error.flatten());
  return result.data;
}

// Exactly one of: pick a template (clones a framework + its course
// together), attach a new course to an existing org framework, or start
// both fresh from scratch (category required in that case).
const createCourseSchema = z
  .object({
    name: z.string().min(1),
    category: z.string().min(1).optional(),
    templateId: z.string().uuid().optional(),
    frameworkId: z.string().uuid().optional(),
  })
  .superRefine((data, ctx) => {
    const provided = [data.templateId, data.frameworkId, data.category].filter((v) => v !== undefined).length;
    if (provided !== 1) {
      ctx.addIssue({ code: 'custom', message: 'Provide exactly one of templateId, frameworkId, or category (to start from scratch)' });
    }
  });
coursesRouter.post('/', async (req, res, next) => {
  try {
    const body = parse(createCourseSchema, req.body);
    res.status(201).json(await cohortService.createCourse(req.auth!.org_id!, req.auth!.sub, body));
  } catch (err) {
    next(err);
  }
});

coursesRouter.get('/', async (req, res, next) => {
  try {
    res.json(await cohortService.listCourses(req.auth!.org_id!));
  } catch (err) {
    next(err);
  }
});

// Rich payload: the course row, its parent framework's name/category, and
// every area with its questions — the area/question editor's single fetch.
coursesRouter.get('/:id', async (req, res, next) => {
  try {
    res.json(await frameworkService.getCourseWithAreas(req.auth!.org_id!, req.params.id));
  } catch (err) {
    next(err);
  }
});

const updateCourseSchema = z.object({ name: z.string().min(1) });
coursesRouter.patch('/:id', async (req, res, next) => {
  try {
    const body = parse(updateCourseSchema, req.body);
    res.json(await frameworkService.updateCourse(req.auth!.org_id!, req.params.id, body));
  } catch (err) {
    next(err);
  }
});

coursesRouter.delete('/:id', async (req, res, next) => {
  try {
    await frameworkService.deleteCourse(req.auth!.org_id!, req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// "Clone to make changes" (FR-M1-05) — a locked course can't be edited
// directly; this makes a fresh unlocked copy under the same framework.
const cloneCourseSchema = z.object({ name: z.string().min(1).optional() });
coursesRouter.post('/:id/clone', async (req, res, next) => {
  try {
    const body = parse(cloneCourseSchema, req.body ?? {});
    const cloned = await frameworkService.cloneCourse(req.auth!.org_id!, req.params.id, body.name);
    res.status(201).json(cloned);
  } catch (err) {
    next(err);
  }
});

const addAreaSchema = z.object({ name: z.string().min(1), description: z.string().optional() });
coursesRouter.post('/:id/areas', async (req, res, next) => {
  try {
    const body = parse(addAreaSchema, req.body);
    const area = await frameworkService.addArea(req.auth!.org_id!, req.params.id, body);
    res.status(201).json(area);
  } catch (err) {
    next(err);
  }
});

const updateAreaSchema = z.object({ name: z.string().min(1).optional(), display_order: z.number().int().optional() });
coursesRouter.patch('/:id/areas/:areaId', async (req, res, next) => {
  try {
    const body = parse(updateAreaSchema, req.body);
    res.json(await frameworkService.updateArea(req.auth!.org_id!, req.params.id, req.params.areaId, body));
  } catch (err) {
    next(err);
  }
});

coursesRouter.delete('/:id/areas/:areaId', async (req, res, next) => {
  try {
    res.json(await frameworkService.deactivateArea(req.auth!.org_id!, req.params.id, req.params.areaId));
  } catch (err) {
    next(err);
  }
});

// Per-type rules (e.g. true/false has two options, self-ratings have no
// correct answer) are enforced by frameworkService.normalizeQuestion.
const questionType = z.enum(['mcq', 'true_false', 'scenario', 'self_rating']);
const createQuestionSchema = z.object({
  question_type: questionType.optional(),
  question_text: z.string().min(1),
  scenario_text: z.string().nullable().optional(),
  option_a: z.string().nullable().optional(),
  option_b: z.string().nullable().optional(),
  option_c: z.string().nullable().optional(),
  option_d: z.string().nullable().optional(),
  correct_option: z.string().nullable().optional(),
  assessment_type: z.enum(['pre', 'post', 'both']).optional(),
});
coursesRouter.post('/:id/areas/:areaId/questions', async (req, res, next) => {
  try {
    const body = parse(createQuestionSchema, req.body);
    const question = await frameworkService.createQuestion(req.auth!.org_id!, req.params.id, req.params.areaId, body);
    res.status(201).json(question);
  } catch (err) {
    next(err);
  }
});

const bulkQuestionsSchema = z.object({ csv: z.string().min(1) });
coursesRouter.post('/:id/areas/:areaId/questions/bulk', async (req, res, next) => {
  try {
    const body = parse(bulkQuestionsSchema, req.body);
    res.status(201).json(await frameworkService.bulkCreateQuestions(req.auth!.org_id!, req.params.id, req.params.areaId, body.csv));
  } catch (err) {
    next(err);
  }
});

const updateQuestionSchema = z.object({
  question_type: questionType.optional(),
  question_text: z.string().min(1).optional(),
  scenario_text: z.string().nullable().optional(),
  option_a: z.string().nullable().optional(),
  option_b: z.string().nullable().optional(),
  option_c: z.string().nullable().optional(),
  option_d: z.string().nullable().optional(),
  correct_option: z.string().nullable().optional(),
  assessment_type: z.enum(['pre', 'post', 'both']).optional(),
  is_active: z.boolean().optional(),
});
coursesRouter.patch('/:id/questions/:qId', async (req, res, next) => {
  try {
    const body = parse(updateQuestionSchema, req.body);
    res.json(await frameworkService.updateQuestion(req.auth!.org_id!, req.params.id, req.params.qId, body));
  } catch (err) {
    next(err);
  }
});

// Question bank: search the org's own questions and Daprova's templates…
coursesRouter.get('/question-bank/search', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;
    res.json(await frameworkService.searchQuestionBank(req.auth!.org_id!, { q, type }));
  } catch (err) {
    next(err);
  }
});

// …and copy chosen ones into an area of this course.
const importQuestionsSchema = z.object({ question_ids: z.array(z.string().uuid()).min(1).max(100) });
coursesRouter.post('/:id/areas/:areaId/questions/import', async (req, res, next) => {
  try {
    const body = parse(importQuestionsSchema, req.body);
    res.status(201).json(await frameworkService.importQuestionsFromBank(req.auth!.org_id!, req.params.id, req.params.areaId, body.question_ids));
  } catch (err) {
    next(err);
  }
});

// Every cohort of this course side by side (mean pre/post/gain, pass rate).
coursesRouter.get('/:id/comparison', async (req, res, next) => {
  try {
    await billing.assertFeature(req.auth!.org_id!, 'multi_cohort_trend_comparison');
    res.json(await insightsService.courseComparison(req.auth!.org_id!, req.params.id));
  } catch (err) {
    next(err);
  }
});

const createCohortSchema = z.object({
  name: z.string().min(1),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  pass_threshold: z.number().min(0).max(100).optional(),
  projected_student_count: z.number().int().positive().optional(),
});
coursesRouter.post('/:id/cohorts', async (req, res, next) => {
  try {
    const body = parse(createCohortSchema, req.body);
    res.status(201).json(await cohortService.createCohort(req.auth!.org_id!, req.auth!.sub, req.params.id, body));
  } catch (err) {
    next(err);
  }
});

coursesRouter.get('/:id/cohorts', async (req, res, next) => {
  try {
    res.json(await cohortService.listCohorts(req.auth!.org_id!, req.params.id));
  } catch (err) {
    next(err);
  }
});
