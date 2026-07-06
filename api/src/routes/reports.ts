import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { badRequest } from '../lib/errors.js';
import * as reportService from '../services/reportService.js';
import { FUNDER_TEMPLATE_LABELS } from '../services/reports/templateRegistry.js';

export const reportsRouter = Router();
reportsRouter.use(requireAuth, requireRole('admin'));

// Registered before '/:id' so the literal path wins the route match.
reportsRouter.get('/templates', (_req, res) => {
  res.json(Object.entries(FUNDER_TEMPLATE_LABELS).map(([key, label]) => ({ key, label })));
});

reportsRouter.get('/:id', async (req, res, next) => {
  try {
    res.json(await reportService.getReport(req.auth!.org_id, req.params.id));
  } catch (err) {
    next(err);
  }
});

const CONTENT_TYPES = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } as const;

reportsRouter.get('/:id/download/:format', async (req, res, next) => {
  try {
    const format = req.params.format;
    if (format !== 'pdf' && format !== 'docx') throw badRequest('Format must be pdf or docx');
    const buf = await reportService.getReportFile(req.auth!.org_id, req.params.id, format);
    res.setHeader('Content-Type', CONTENT_TYPES[format]);
    res.setHeader('Content-Disposition', `attachment; filename="report-${req.params.id}.${format}"`);
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

const narrativeSchema = z.object({
  narrative: z.object({
    background: z.string().default(''),
    challenges: z.string().default(''),
    next_steps: z.string().default(''),
  }),
});
reportsRouter.patch('/:id/narrative', async (req, res, next) => {
  try {
    const body = narrativeSchema.parse(req.body);
    res.json(await reportService.regenerateReport(req.auth!.org_id, req.params.id, body.narrative));
  } catch (err) {
    next(err instanceof z.ZodError ? badRequest('Invalid request body', err.flatten()) : err);
  }
});
