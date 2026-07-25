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

// Imports a whole multi-course template (framework + every course under it)
// into this org — distinct from POST /courses's single-course template pick.
const importTemplateSchema = z.object({ templateId: z.string().uuid() });
frameworksRouter.post('/from-template', async (req, res, next) => {
  try {
    const body = parse(importTemplateSchema, req.body);
    const result = await frameworkService.importTemplateFramework(req.auth!.org_id!, req.auth!.sub, body.templateId);
    res.status(201).json(result);
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

// A framework's own detail is just its name/category plus the list of
// Courses under it (each Course owns its own areas/questions) — see
// GET /courses/:id for the area/question editor payload.
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

frameworksRouter.delete('/:id', async (req, res, next) => {
  try {
    await frameworkService.deleteFramework(req.auth!.org_id!, req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
