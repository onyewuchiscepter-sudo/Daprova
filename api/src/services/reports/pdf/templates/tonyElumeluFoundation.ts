
import type { ReportDataContract } from '../../../reportDataService.js';
import { drawKeyValueGrid, drawParagraph, drawReportHeader, drawSectionTitle, drawTable, formatPct, formatSigned } from '../primitives.js';

// Required sections per spec: Entrepreneur profile, training overview,
// skills acquired (competency scores), business readiness score, next
// steps. TEF focuses on entrepreneurship — confidence index used as
// business readiness proxy.
export function renderTonyElumeluFoundation(doc: PDFKit.PDFDocument, data: ReportDataContract) {
  drawReportHeader(doc, {
    templateTitle: 'Tony Elumelu Foundation — Entrepreneur Development Report',
    orgName: data.org.name,
    cohortName: data.cohort.name,
    courseName: data.cohort.course_name,
    dateRange: `${data.cohort.start_date ?? 'Start TBC'} – ${data.cohort.end_date ?? 'End TBC'}`,
  });

  drawSectionTitle(doc, 'Entrepreneur Profile');
  drawTable(
    doc,
    ['Gender', 'n', 'Pass rate'],
    data.equity.by_gender.map((g) => [g.label.replace(/_/g, ' '), String(g.n), formatPct(g.pass_rate)]),
  );

  drawSectionTitle(doc, 'Training Overview');
  drawKeyValueGrid(doc, [
    ['Total enrolled', String(data.cohort.total_enrolled)],
    ['Completed training cycle', String(data.cohort.total_post_completed)],
    ['Pre-assessment completed', String(data.cohort.total_pre_completed)],
    ['Mean learning gain', formatSigned(data.learning_gains.mean_gain, ' pts')],
  ]);

  drawSectionTitle(doc, 'Skills Acquired (Competency Scores)');
  drawTable(
    doc,
    ['Competency area', 'Pre', 'Post', 'Gain'],
    data.learning_gains.competency_breakdown.map((a) => [a.area_name, formatPct(a.pre_pct), formatPct(a.post_pct), formatSigned(a.gain)]),
  );

  drawSectionTitle(doc, 'Business Readiness Score');
  drawParagraph(
    doc,
    'Business readiness is approximated using learners\' self-reported confidence across competency areas, on a 1 (not confident) to 5 (very confident) scale.',
  );
  drawKeyValueGrid(doc, [
    ['Confidence — pre-training', data.learning_gains.mean_confidence_pre?.toString() ?? '—'],
    ['Confidence — post-training', data.learning_gains.mean_confidence_post?.toString() ?? '—'],
    [
      'Confidence gain',
      data.learning_gains.mean_confidence_pre !== null && data.learning_gains.mean_confidence_post !== null
        ? formatSigned(Math.round((data.learning_gains.mean_confidence_post - data.learning_gains.mean_confidence_pre) * 100) / 100)
        : '—',
    ],
  ]);

  drawSectionTitle(doc, 'Next Steps');
  drawParagraph(doc, data.narrative.next_steps);
}
