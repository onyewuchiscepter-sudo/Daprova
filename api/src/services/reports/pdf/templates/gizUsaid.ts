
import type { ReportDataContract } from '../../../reportDataService.js';
import { drawNumberedList, drawParagraph, drawReportHeader, drawSectionTitle, drawTable, formatPct, formatSigned } from '../primitives.js';

// Required sections per spec: Project summary, output indicators, outcome
// indicators (learning gains), disaggregated results, lessons learned.
// Results framework format — indicators must be numbered.
export function renderGizUsaid(doc: PDFKit.PDFDocument, data: ReportDataContract) {
  drawReportHeader(doc, {
    templateTitle: 'GIZ / USAID — Results Framework Report',
    orgName: data.org.name,
    cohortName: data.cohort.name,
    courseName: data.cohort.course_name,
    dateRange: `${data.cohort.start_date ?? 'Start TBC'} – ${data.cohort.end_date ?? 'End TBC'}`,
  });

  drawSectionTitle(doc, 'Project Summary');
  drawParagraph(doc, data.narrative.background);

  drawSectionTitle(doc, 'Output Indicators');
  drawNumberedList(doc, [
    `Total learners enrolled: ${data.cohort.total_enrolled}`,
    `Learners completing pre-assessment: ${data.cohort.total_pre_completed}`,
    `Learners completing post-assessment: ${data.cohort.total_post_completed}`,
  ]);

  drawSectionTitle(doc, 'Outcome Indicators (Learning Gains)');
  drawNumberedList(doc, [
    `Mean learning gain: ${formatSigned(data.learning_gains.mean_gain, ' pts')}`,
    `Pass rate against competency threshold: ${formatPct(data.learning_gains.pass_rate)}`,
    `Effect size (Cohen's d): ${data.learning_gains.cohens_d?.toString() ?? '—'}`,
  ]);
  drawTable(
    doc,
    ['Competency area', 'Pre', 'Post', 'Gain'],
    data.learning_gains.competency_breakdown.map((a) => [a.area_name, formatPct(a.pre_pct), formatPct(a.post_pct), formatSigned(a.gain)]),
  );

  drawSectionTitle(doc, 'Disaggregated Results');
  drawTable(doc, ['Gender', 'n', 'Mean gain', 'Pass rate'], data.equity.by_gender.map((g) => [g.label.replace(/_/g, ' '), String(g.n), formatSigned(g.mean_gain), formatPct(g.pass_rate)]));
  drawTable(doc, ['Location', 'n', 'Mean gain', 'Pass rate'], data.equity.by_location.map((g) => [g.label, String(g.n), formatSigned(g.mean_gain), formatPct(g.pass_rate)]));
  drawTable(doc, ['Age group', 'n', 'Mean gain', 'Pass rate'], data.equity.by_age_group.map((g) => [g.label, String(g.n), formatSigned(g.mean_gain), formatPct(g.pass_rate)]));

  drawSectionTitle(doc, 'Lessons Learned');
  drawParagraph(doc, data.narrative.challenges);
  drawSectionTitle(doc, 'Recommendations / Next Steps');
  drawParagraph(doc, data.narrative.next_steps);
}
