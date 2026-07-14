import { sql } from 'kysely';
import { db } from '../db/index.js';
import { notFound } from '../lib/errors.js';
import { buildReportDataContract, type NarrativeFields } from './reportDataService.js';
import { renderReportPdf } from './reports/pdf/index.js';
import { renderReportDocx } from './reports/docx/index.js';
import type { FunderTemplateKey } from './reports/templateRegistry.js';
import { assertFeature } from './pricingService.js';

const REPORT_LIST_COLUMNS = ['id', 'cohort_id', 'funder_template', 'narrative_json', 'status', 'generated_at'] as const;

// Report generation is synchronous (no job queue) — pdfkit/docx rendering
// for a single cohort's report takes well under a second, so a queue would
// add operational complexity (worker process, retry/poll UI) without a
// user-visible benefit at this scale.
export async function generateReport(orgId: string, cohortId: string, templateKey: FunderTemplateKey, narrative: NarrativeFields, generatedBy: string) {
  // docs/org-onboarding-spec.md §5.3 — exportable/downloadable reports are
  // gated from GROWTH upward; FREE_TRIAL/ENTRY don't include the feature.
  // Scoped to this specific cohort's tier, not the org's — pricing is
  // per-cohort (§5.7).
  await assertFeature(orgId, cohortId, 'exportable_reports');

  const data = await buildReportDataContract(orgId, cohortId, narrative);
  const [pdf, docx] = await Promise.all([renderReportPdf(templateKey, data), renderReportDocx(templateKey, data)]);

  return db
    .insertInto('cohort_reports')
    .values({
      cohort_id: cohortId,
      generated_by: generatedBy,
      funder_template: templateKey,
      narrative_json: narrative,
      pdf_data: pdf,
      docx_data: docx,
    })
    .returning(REPORT_LIST_COLUMNS)
    .executeTakeFirstOrThrow();
}

async function assertCohortInOrg(orgId: string, cohortId: string) {
  const cohort = await db
    .selectFrom('cohorts')
    .innerJoin('courses', 'courses.id', 'cohorts.course_id')
    .select('cohorts.id')
    .where('cohorts.id', '=', cohortId)
    .where('courses.org_id', '=', orgId)
    .where('cohorts.deleted_at', 'is', null)
    .executeTakeFirst();
  if (!cohort) throw notFound('Cohort not found');
}

export async function listReports(orgId: string, cohortId: string) {
  await assertCohortInOrg(orgId, cohortId);
  return db.selectFrom('cohort_reports').select(REPORT_LIST_COLUMNS).where('cohort_id', '=', cohortId).orderBy('generated_at', 'desc').execute();
}

async function assertReportInOrg(orgId: string, reportId: string) {
  const row = await db
    .selectFrom('cohort_reports')
    .innerJoin('cohorts', 'cohorts.id', 'cohort_reports.cohort_id')
    .innerJoin('courses', 'courses.id', 'cohorts.course_id')
    .selectAll('cohort_reports')
    .select('courses.org_id')
    .where('cohort_reports.id', '=', reportId)
    .where('courses.org_id', '=', orgId)
    .executeTakeFirst();
  if (!row) throw notFound('Report not found');
  return row;
}

export async function getReport(orgId: string, reportId: string) {
  const { pdf_data, docx_data, org_id, ...meta } = await assertReportInOrg(orgId, reportId);
  return meta;
}

export async function getReportFile(orgId: string, reportId: string, format: 'pdf' | 'docx') {
  const row = await assertReportInOrg(orgId, reportId);
  const buf = format === 'pdf' ? row.pdf_data : row.docx_data;
  if (!buf) throw notFound('Report file not available');
  return buf;
}

export async function regenerateReport(orgId: string, reportId: string, narrative: NarrativeFields) {
  const existing = await assertReportInOrg(orgId, reportId);
  const data = await buildReportDataContract(orgId, existing.cohort_id, narrative);
  const templateKey = existing.funder_template as FunderTemplateKey;
  const [pdf, docx] = await Promise.all([renderReportPdf(templateKey, data), renderReportDocx(templateKey, data)]);

  return db
    .updateTable('cohort_reports')
    .set({ narrative_json: narrative, pdf_data: pdf, docx_data: docx, generated_at: sql`now()` })
    .where('id', '=', reportId)
    .returning(REPORT_LIST_COLUMNS)
    .executeTakeFirstOrThrow();
}
