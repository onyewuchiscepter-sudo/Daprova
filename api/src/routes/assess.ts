import { Router } from 'express';
import { z } from 'zod';
import { badRequest } from '../lib/errors.js';
import * as assessmentService from '../services/assessmentService.js';

export const assessRouter = Router();

function parse<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw badRequest('Invalid request body', result.error.flatten());
  return result.data;
}

// Spec (B3.6) lists this as GET, but it needs to accept a demographics body on
// first visit (FR-M2-07) — POST is used here instead. /start is already a
// verb-suffixed action route by the spec's own naming, so this doesn't add a
// new REST-purity violation, just makes the existing one carry a body.
const startSchema = z.object({
  learner_token: z.string().uuid().optional(),
  demographics: z
    .object({
      gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
      age_group: z.enum(['15-24', '25-34', '35-44', '45+']).optional(),
      location_type: z.enum(['urban', 'rural', 'peri-urban']).optional(),
      disability: z.enum(['yes', 'no', 'prefer_not_to_say']).optional(),
    })
    .optional(),
  display_name: z.string().optional(),
  enrolment_id: z.string().optional(),
});
assessRouter.post('/:cohortToken/start', async (req, res, next) => {
  try {
    const body = parse(startSchema, req.body ?? {});
    res.json(await assessmentService.startSession(req.params.cohortToken, body));
  } catch (err) {
    next(err);
  }
});

const singleResponseSchema = z.object({
  learner_token: z.string().uuid(),
  question_id: z.string().uuid(),
  selected_option: z.enum(['a', 'b', 'c', 'd']),
});
const batchResponseSchema = z.object({
  learner_token: z.string().uuid(),
  responses: z.array(z.object({ question_id: z.string().uuid(), selected_option: z.enum(['a', 'b', 'c', 'd']) })).min(1),
});
assessRouter.post('/:cohortToken/response', async (req, res, next) => {
  try {
    const batch = batchResponseSchema.safeParse(req.body);
    if (batch.success) {
      res.json(await assessmentService.recordResponses(req.params.cohortToken, batch.data.learner_token, batch.data.responses));
      return;
    }
    const single = parse(singleResponseSchema, req.body);
    res.json(
      await assessmentService.recordResponses(req.params.cohortToken, single.learner_token, [
        { question_id: single.question_id, selected_option: single.selected_option },
      ]),
    );
  } catch (err) {
    next(err);
  }
});

const submitSchema = z.object({
  learner_token: z.string().uuid(),
  confidence: z.array(z.object({ area_id: z.string().uuid(), rating: z.number().int().min(1).max(5) })).optional(),
});
assessRouter.post('/:cohortToken/submit', async (req, res, next) => {
  try {
    const body = parse(submitSchema, req.body);
    res.json(await assessmentService.submitSession(req.params.cohortToken, body.learner_token, body.confidence));
  } catch (err) {
    next(err);
  }
});

assessRouter.get('/:cohortToken/result/:learnerToken', async (req, res, next) => {
  try {
    res.json(await assessmentService.getResult(req.params.cohortToken, req.params.learnerToken));
  } catch (err) {
    next(err);
  }
});
