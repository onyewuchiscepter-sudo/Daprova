import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { badRequest } from '../lib/errors.js';
import * as cohortService from '../services/cohortService.js';
import * as analyticsService from '../services/analyticsService.js';
import * as dataQualityService from '../services/dataQualityService.js';
import * as reportService from '../services/reportService.js';
import * as paymentService from '../services/paymentService.js';
import * as reminderService from '../services/reminderService.js';
import * as shareService from '../services/shareService.js';
import * as certificateService from '../services/certificateService.js';
import { isFunderTemplateKey } from '../services/reports/templateRegistry.js';
import { toCsv } from '../lib/csv.js';

export const cohortsRouter = Router();
cohortsRouter.use(requireAuth, requireRole('admin'));

function parse<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw badRequest('Invalid request body', result.error.flatten());
  return result.data;
}

cohortsRouter.get('/', async (req, res, next) => {
  try {
    res.json(await cohortService.listOrgCohorts(req.auth!.org_id!));
  } catch (err) {
    next(err);
  }
});

cohortsRouter.get('/:id', async (req, res, next) => {
  try {
    res.json(await cohortService.getCohort(req.auth!.org_id!, req.params.id));
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
    res.json(await cohortService.updateCohort(req.auth!.org_id!, req.params.id, body));
  } catch (err) {
    next(err);
  }
});

cohortsRouter.get('/:id/learners', async (req, res, next) => {
  try {
    res.json(await cohortService.listCohortLearners(req.auth!.org_id!, req.params.id));
  } catch (err) {
    next(err);
  }
});

// Raw per-learner roster export — distinct from the aggregate funder
// PDF/Word reports (reportService.ts), which never expose individual names.
cohortsRouter.get('/:id/learners/export.csv', async (req, res, next) => {
  try {
    const learners = await cohortService.listCohortLearners(req.auth!.org_id!, req.params.id);
    const rows = learners.map((l) => ({
      ...l,
      gain: l.pre_score !== null && l.post_score !== null ? Math.round((Number(l.post_score) - Number(l.pre_score)) * 100) / 100 : null,
    }));
    const csv = toCsv(rows, [
      { key: 'display_name', label: 'Name' },
      { key: 'enrolment_id', label: 'Enrolment ID' },
      { key: 'gender', label: 'Gender' },
      { key: 'age_group', label: 'Age group' },
      { key: 'location_type', label: 'Location' },
      { key: 'disability', label: 'Disability' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'certificate_code', label: 'Certificate' },
      { key: 'pre_status', label: 'Pre-assessment status' },
      { key: 'pre_score', label: 'Pre-assessment score' },
      { key: 'post_status', label: 'Post-assessment status' },
      { key: 'post_score', label: 'Post-assessment score' },
      { key: 'gain', label: 'Gain' },
    ]);
    res.set('Content-Type', 'text/csv').set('Content-Disposition', 'attachment; filename="learners.csv"').send(csv);
  } catch (err) {
    next(err);
  }
});

const regenerateLinkSchema = z.object({ type: z.enum(['pre', 'post', 'satisfaction', 'tracer']) });
cohortsRouter.post('/:id/regenerate-link', async (req, res, next) => {
  try {
    const body = parse(regenerateLinkSchema, req.body);
    res.json(await cohortService.regenerateLinkToken(req.auth!.org_id!, req.params.id, body.type));
  } catch (err) {
    next(err);
  }
});

const dashboardFiltersSchema = z.object({
  gender: z.string().optional(),
  age_group: z.string().optional(),
  location_type: z.string().optional(),
  disability: z.string().optional(),
});

// GET /api/v1/cohorts/:id/dashboard — B3.5's "full cohort analytics dashboard
// data": mean gain, Cohen's d, and the competency-level breakdown together.
// US-13: accepts the same 4 demographic filters (compound, all optional) so
// applying a filter updates every metric here simultaneously.
cohortsRouter.get('/:id/dashboard', async (req, res, next) => {
  try {
    const cohort = await cohortService.getCohort(req.auth!.org_id!, req.params.id);
    const filters = parse(dashboardFiltersSchema, req.query);
    const passThreshold = Number(cohort.pass_threshold);
    const [gains, effectSize, competencyBreakdown, passRate, selfRatings] = await Promise.all([
      analyticsService.getMeanGain(cohort.id, filters),
      analyticsService.getCohensD(cohort.id, filters),
      analyticsService.getCompetencyBreakdown(cohort.id, cohort.course_id, filters),
      analyticsService.getPassRate(cohort.id, passThreshold, filters),
      analyticsService.getSelfRatings(cohort.id),
    ]);
    res.json({
      ...gains,
      cohens_d: effectSize.cohens_d,
      pass_threshold: passThreshold,
      pass_rate: passRate,
      competency_breakdown: competencyBreakdown,
      self_ratings: selfRatings,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/cohorts/:id/equity — Module 3, all four demographic dimensions
// in one response rather than one call per dimension.
cohortsRouter.get('/:id/equity', async (req, res, next) => {
  try {
    const cohort = await cohortService.getCohort(req.auth!.org_id!, req.params.id);
    const dimensions = ['gender', 'age_group', 'location_type', 'disability'] as const;
    const breakdowns = await Promise.all(dimensions.map((d) => analyticsService.getEquityBreakdown(cohort.id, d)));
    res.json(breakdowns);
  } catch (err) {
    next(err);
  }
});

// Module 5 (S11) — cohort-level satisfaction survey aggregate for the dashboard.
cohortsRouter.get('/:id/satisfaction', async (req, res, next) => {
  try {
    const cohort = await cohortService.getCohort(req.auth!.org_id!, req.params.id);
    res.json(await analyticsService.getSatisfactionSummary(cohort.id));
  } catch (err) {
    next(err);
  }
});

const generateReportSchema = z.object({
  template: z.string().refine(isFunderTemplateKey, 'Unknown funder template'),
  narrative: z.object({
    background: z.string().default(''),
    challenges: z.string().default(''),
    next_steps: z.string().default(''),
  }),
});
cohortsRouter.post('/:id/reports', async (req, res, next) => {
  try {
    const body = generateReportSchema.parse(req.body);
    const report = await reportService.generateReport(req.auth!.org_id!, req.params.id, body.template, body.narrative, req.auth!.sub);
    res.status(201).json(report);
  } catch (err) {
    next(err instanceof z.ZodError ? badRequest('Invalid request body', err.flatten()) : err);
  }
});

// Preview (PRD US-16): same body as generating, returns the PDF inline and
// saves nothing.
cohortsRouter.post('/:id/reports/preview', async (req, res, next) => {
  try {
    const body = generateReportSchema.parse(req.body);
    const { pdf, watermarked } = await reportService.previewReport(req.auth!.org_id!, req.params.id, body.template, body.narrative);
    res.set('Content-Type', 'application/pdf').set('Content-Disposition', 'inline; filename="report-preview.pdf"').set('X-Report-Watermarked', String(watermarked)).set('Access-Control-Expose-Headers', 'X-Report-Watermarked').send(pdf);
  } catch (err) {
    next(err instanceof z.ZodError ? badRequest('Invalid request body', err.flatten()) : err);
  }
});

cohortsRouter.get('/:id/reports', async (req, res, next) => {
  try {
    res.json(await reportService.listReports(req.auth!.org_id!, req.params.id));
  } catch (err) {
    next(err);
  }
});

// docs/org-onboarding-spec.md §5.6 — surfaced from the "block" capacity
// banner (CohortDashboardPage.tsx) as an "Upgrade now" action.
cohortsRouter.post('/:id/upgrade', async (req, res, next) => {
  try {
    const purpose = req.body?.purpose === 'feature' ? 'feature' : 'capacity';
    res.status(201).json(await paymentService.requestUpgrade(req.auth!.org_id!, req.params.id, purpose));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/cohorts/:id/run-outlier-detection — admin-triggered stand-in
// for the spec's "background job after cohort closes" (no task-queue infra
// in this MVP to schedule it automatically).
cohortsRouter.post('/:id/run-outlier-detection', async (req, res, next) => {
  try {
    const cohort = await cohortService.getCohort(req.auth!.org_id!, req.params.id);
    res.json(await dataQualityService.runOutlierDetection(cohort.id));
  } catch (err) {
    next(err);
  }
});

// Module 6 — tracer (follow-up) survey results.
cohortsRouter.get('/:id/outcomes', async (req, res, next) => {
  try {
    const cohort = await cohortService.getCohort(req.auth!.org_id!, req.params.id);
    res.json(await analyticsService.getOutcomesSummary(cohort.id));
  } catch (err) {
    next(err);
  }
});

// Completion certificate for one learner (admin download).
cohortsRouter.get('/:id/learners/:learnerId/certificate', async (req, res, next) => {
  try {
    const { pdf, filename } = await certificateService.certificateForAdmin(req.auth!.org_id!, req.params.id, req.params.learnerId);
    res.set('Content-Type', 'application/pdf').set('Content-Disposition', `attachment; filename="${filename}"`).send(pdf);
  } catch (err) {
    next(err);
  }
});

// Reminders — who still needs to finish a step, and nudging them.
const reminderKind = z.enum(['post', 'satisfaction', 'tracer']);
cohortsRouter.get('/:id/reminders', async (req, res, next) => {
  try {
    const kind = reminderKind.catch('post').parse(req.query.kind);
    res.json(await reminderService.getReminderCandidates(req.auth!.org_id!, req.params.id, kind));
  } catch (err) {
    next(err);
  }
});

const sendRemindersSchema = z.object({
  kind: reminderKind,
  channel: z.enum(['email', 'sms']),
  learner_ids: z.array(z.string().uuid()).optional(),
});
cohortsRouter.post('/:id/reminders', async (req, res, next) => {
  try {
    const body = parse(sendRemindersSchema, req.body);
    res.json(await reminderService.sendReminders(req.auth!.org_id!, req.params.id, body.kind, body.channel, req.auth!.sub, body.learner_ids));
  } catch (err) {
    next(err);
  }
});

// WhatsApp reminders are sent by the admin from their own WhatsApp; this
// records it so "last reminded" and the cooldown stay accurate.
const logReminderSchema = z.object({ kind: reminderKind, learner_id: z.string().uuid() });
cohortsRouter.post('/:id/reminders/log', async (req, res, next) => {
  try {
    const body = parse(logReminderSchema, req.body);
    res.json(await reminderService.logManualReminder(req.auth!.org_id!, req.params.id, body.learner_id, body.kind, req.auth!.sub));
  } catch (err) {
    next(err);
  }
});

cohortsRouter.get('/:id/reminders/history', async (req, res, next) => {
  try {
    res.json(await reminderService.reminderHistory(req.auth!.org_id!, req.params.id));
  } catch (err) {
    next(err);
  }
});

// Funder share links (read-only public results page).
cohortsRouter.get('/:id/share-links', async (req, res, next) => {
  try {
    res.json(await shareService.listShareLinks(req.auth!.org_id!, req.params.id));
  } catch (err) {
    next(err);
  }
});

const createShareSchema = z.object({ label: z.string().max(120).optional() });
cohortsRouter.post('/:id/share-links', async (req, res, next) => {
  try {
    const body = parse(createShareSchema, req.body ?? {});
    res.status(201).json(await shareService.createShareLink(req.auth!.org_id!, req.params.id, body.label, req.auth!.sub));
  } catch (err) {
    next(err);
  }
});

cohortsRouter.delete('/:id/share-links/:linkId', async (req, res, next) => {
  try {
    res.json(await shareService.revokeShareLink(req.auth!.org_id!, req.params.id, req.params.linkId));
  } catch (err) {
    next(err);
  }
});
