import { Router } from 'express';
import { z } from 'zod';
import { badRequest } from '../lib/errors.js';
import * as teachableService from '../services/teachableService.js';

export const webhooksRouter = Router();

const teachableWebhookSchema = z.object({ cohort_id: z.string().uuid(), enrolment_id: z.string().min(1) });

webhooksRouter.post('/teachable', async (req, res, next) => {
  try {
    const result = teachableWebhookSchema.safeParse(req.body);
    if (!result.success) throw badRequest('Invalid webhook payload', result.error.flatten());
    res.json(await teachableService.handleCourseCompletion(result.data.cohort_id, result.data.enrolment_id));
  } catch (err) {
    next(err);
  }
});
