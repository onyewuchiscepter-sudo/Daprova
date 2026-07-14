import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { badRequest } from '../lib/errors.js';
import * as frameworkService from '../services/frameworkService.js';

export const frameworksRouter = Router();
frameworksRouter.use(requireAuth, requireRole('admin'));

function parse<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw badRequest('Invalid request body', result.error.flatten());
  return result.data;
}

frameworksRouter.get('/templates', async (_req, res, next) => {
  try {
    res.json(await frameworkService.listTemplates());
  } catch (err) {
    next(err);
  }
});

frameworksRouter.get('/', async (req, res, next) => {
  try {
    res.json(await frameworkService.listFrameworks(req.auth!.org_id!));
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({ templateId: z.string().uuid().optional(), name: z.string().min(1), category: z.string().min(1).optional() });
frameworksRouter.post('/', async (req, res, next) => {
  try {
    const body = parse(createSchema, req.body);
    const framework = await frameworkService.createFramework(req.auth!.org_id!, req.auth!.sub, {
      templateId: body.templateId,
      name: body.name,
      category: body.category ?? '',
    });
    res.status(201).json(framework);
  } catch (err) {
    next(err);
  }
});

frameworksRouter.get('/:id', async (req, res, next) => {
  try {
    res.json(await frameworkService.getFrameworkDetail(req.auth!.org_id!, req.params.id));
  } catch (err) {
    next(err);
  }
});

const patchNameSchema = z.object({ name: z.string().min(1) });
frameworksRouter.patch('/:id', async (req, res, next) => {
  try {
    const body = parse(patchNameSchema, req.body);
    res.json(await frameworkService.updateFrameworkName(req.auth!.org_id!, req.params.id, body.name));
  } catch (err) {
    next(err);
  }
});

const cloneSchema = z.object({ name: z.string().min(1).optional() });
frameworksRouter.post('/:id/clone', async (req, res, next) => {
  try {
    const body = parse(cloneSchema, req.body ?? {});
    const cloned = await frameworkService.cloneFramework(req.auth!.org_id!, req.auth!.sub, req.params.id, body.name);
    res.status(201).json(cloned);
  } catch (err) {
    next(err);
  }
});

const addAreaSchema = z.object({ name: z.string().min(1), description: z.string().optional() });
frameworksRouter.post('/:id/areas', async (req, res, next) => {
  try {
    const body = parse(addAreaSchema, req.body);
    const area = await frameworkService.addArea(req.auth!.org_id!, req.params.id, body);
    res.status(201).json(area);
  } catch (err) {
    next(err);
  }
});

const updateAreaSchema = z.object({ name: z.string().min(1).optional(), display_order: z.number().int().optional() });
frameworksRouter.patch('/:id/areas/:areaId', async (req, res, next) => {
  try {
    const body = parse(updateAreaSchema, req.body);
    res.json(await frameworkService.updateArea(req.auth!.org_id!, req.params.id, req.params.areaId, body));
  } catch (err) {
    next(err);
  }
});

frameworksRouter.delete('/:id/areas/:areaId', async (req, res, next) => {
  try {
    res.json(await frameworkService.deactivateArea(req.auth!.org_id!, req.params.id, req.params.areaId));
  } catch (err) {
    next(err);
  }
});

const createQuestionSchema = z.object({
  question_text: z.string().min(1),
  option_a: z.string().min(1),
  option_b: z.string().min(1),
  option_c: z.string().min(1),
  option_d: z.string().min(1),
  correct_option: z.enum(['a', 'b', 'c', 'd']),
  assessment_type: z.enum(['pre', 'post', 'both']).optional(),
});
frameworksRouter.post('/:id/areas/:areaId/questions', async (req, res, next) => {
  try {
    const body = parse(createQuestionSchema, req.body);
    const question = await frameworkService.createQuestion(req.auth!.org_id!, req.params.id, req.params.areaId, body);
    res.status(201).json(question);
  } catch (err) {
    next(err);
  }
});

const bulkQuestionsSchema = z.object({ csv: z.string().min(1) });
frameworksRouter.post('/:id/areas/:areaId/questions/bulk', async (req, res, next) => {
  try {
    const body = parse(bulkQuestionsSchema, req.body);
    res.status(201).json(await frameworkService.bulkCreateQuestions(req.auth!.org_id!, req.params.id, req.params.areaId, body.csv));
  } catch (err) {
    next(err);
  }
});

const updateQuestionSchema = z.object({
  question_text: z.string().min(1).optional(),
  option_a: z.string().min(1).optional(),
  option_b: z.string().min(1).optional(),
  option_c: z.string().min(1).optional(),
  option_d: z.string().min(1).optional(),
  correct_option: z.enum(['a', 'b', 'c', 'd']).optional(),
  assessment_type: z.enum(['pre', 'post', 'both']).optional(),
  is_active: z.boolean().optional(),
});
frameworksRouter.patch('/:id/questions/:qId', async (req, res, next) => {
  try {
    const body = parse(updateQuestionSchema, req.body);
    res.json(await frameworkService.updateQuestion(req.auth!.org_id!, req.params.id, req.params.qId, body));
  } catch (err) {
    next(err);
  }
});
