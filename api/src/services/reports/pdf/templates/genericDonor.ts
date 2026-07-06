
import type { ReportDataContract } from '../../../reportDataService.js';
import { drawKeyValueGrid, drawParagraph, drawReportHeader, drawSectionTitle, drawTable, formatPct, formatSigned } from '../primitives.js';

// Required sections per spec: Executive summary, programme data, learning
// outcomes, equity outcomes, recommendations. Flexible format for any funder
// not covered by the other three templates.
export function renderGenericDonor(doc: PDFKit.PDFDocument, data: ReportDataContract) {
  drawReportHeader(doc, {
    templateTitle: 'Programme Impact Report',
    orgName: data.org.name,
    cohortName: data.cohort.name,
    courseName: data.cohort.course_name,
    dateRange: `${data.cohort.start_date ?? 'Start TBC'} – ${data.cohort.end_date ?? 'End TBC'}`,
  });

  drawSectionTitle(doc, 'Executive Summary');
  drawParagraph(doc, data.narrative.background);

  drawSectionTitle(doc, 'Programme Data');
  drawKeyValueGrid(doc, [
    ['Total enrolled', String(data.cohort.total_enrolled)],
    ['Pre-assessment completed', String(data.cohort.total_pre_completed)],
    ['Post-assessment completed', String(data.cohort.total_post_completed)],
    ['Mean learning gain', formatSigned(data.learning_gains.mean_gain, ' pts')],
  ]);

  drawSectionTitle(doc, 'Learning Outcomes');
  drawTable(
    doc,
    ['Metric', 'Value'],
    [
      ['Mean pre-assessment score', formatPct(data.learning_gains.mean_pre_score)],
      ['Mean post-assessment score', formatPct(data.learning_gains.mean_post_score)],
      ['Pass rate', formatPct(data.learning_gains.pass_rate)],
    ],
    [250, 150],
  );
  drawTable(
    doc,
    ['Competency area', 'Pre', 'Post', 'Gain'],
    data.learning_gains.competency_breakdown.map((a) => [a.area_name, formatPct(a.pre_pct), formatPct(a.post_pct), formatSigned(a.gain)]),
  );

  drawSectionTitle(doc, 'Equity Outcomes');
  drawTable(doc, ['Gender', 'n', 'Mean gain', 'Pass rate'], data.equity.by_gender.map((g) => [g.label.replace(/_/g, ' '), String(g.n), formatSigned(g.mean_gain), formatPct(g.pass_rate)]));
  drawTable(doc, ['Location', 'n', 'Mean gain', 'Pass rate'], data.equity.by_location.map((g) => [g.label, String(g.n), formatSigned(g.mean_gain), formatPct(g.pass_rate)]));

  drawSectionTitle(doc, 'Recommendations');
  drawParagraph(doc, data.narrative.next_steps);
  if (data.narrative.challenges) {
    drawSectionTitle(doc, 'Challenges Faced');
    drawParagraph(doc, data.narrative.challenges);
  }
}
