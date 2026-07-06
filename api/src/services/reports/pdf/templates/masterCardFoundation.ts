
import type { ReportDataContract } from '../../../reportDataService.js';
import { drawKeyValueGrid, drawNumberedList, drawParagraph, drawReportHeader, drawSectionTitle, drawTable, formatPct, formatSigned } from '../primitives.js';

// Required sections per spec: Programme overview, theory of change
// alignment, learner demographics, pre/post learning gains, equity
// breakdown, key achievements, challenges, next steps. Must use MCF results
// framework terminology.
export function renderMasterCardFoundation(doc: PDFKit.PDFDocument, data: ReportDataContract) {
  drawReportHeader(doc, {
    templateTitle: 'MasterCard Foundation — Programme Impact Report',
    orgName: data.org.name,
    cohortName: data.cohort.name,
    courseName: data.cohort.course_name,
    dateRange: `${data.cohort.start_date ?? 'Start TBC'} – ${data.cohort.end_date ?? 'End TBC'}`,
  });

  drawSectionTitle(doc, 'Programme Overview');
  drawKeyValueGrid(doc, [
    ['Total enrolled', String(data.cohort.total_enrolled)],
    ['Pre-assessment completed', String(data.cohort.total_pre_completed)],
    ['Post-assessment completed', String(data.cohort.total_post_completed)],
    ['Mean learning gain', formatSigned(data.learning_gains.mean_gain, ' pts')],
  ]);

  drawSectionTitle(doc, 'Theory of Change Alignment');
  drawParagraph(doc, data.narrative.background);

  drawSectionTitle(doc, 'Learner Demographics');
  drawTable(
    doc,
    ['Gender', 'n', 'Mean gain', 'Pass rate'],
    data.equity.by_gender.map((g) => [g.label.replace(/_/g, ' '), String(g.n), formatSigned(g.mean_gain), formatPct(g.pass_rate)]),
  );

  drawSectionTitle(doc, 'Pre/Post Learning Gains');
  drawTable(
    doc,
    ['Metric', 'Value'],
    [
      ['Mean pre-assessment score', formatPct(data.learning_gains.mean_pre_score)],
      ['Mean post-assessment score', formatPct(data.learning_gains.mean_post_score)],
      ['Mean gain', formatSigned(data.learning_gains.mean_gain, ' pts')],
      ['Pass rate', formatPct(data.learning_gains.pass_rate)],
      ["Effect size (Cohen's d)", data.learning_gains.cohens_d?.toString() ?? '—'],
    ],
    [250, 150],
  );
  drawTable(
    doc,
    ['Competency area', 'Pre', 'Post', 'Gain'],
    data.learning_gains.competency_breakdown.map((a) => [a.area_name, formatPct(a.pre_pct), formatPct(a.post_pct), formatSigned(a.gain)]),
  );

  drawSectionTitle(doc, 'Equity Breakdown');
  drawTable(doc, ['Location', 'n', 'Mean gain', 'Pass rate'], data.equity.by_location.map((g) => [g.label, String(g.n), formatSigned(g.mean_gain), formatPct(g.pass_rate)]));
  drawTable(doc, ['Age group', 'n', 'Mean gain', 'Pass rate'], data.equity.by_age_group.map((g) => [g.label, String(g.n), formatSigned(g.mean_gain), formatPct(g.pass_rate)]));

  drawSectionTitle(doc, 'Key Achievements');
  const achievements: string[] = [];
  if (data.learning_gains.mean_gain !== null) achievements.push(`Learners achieved a mean gain of ${formatSigned(data.learning_gains.mean_gain, ' pts')} between pre- and post-assessment.`);
  if (data.learning_gains.pass_rate !== null) achievements.push(`${formatPct(data.learning_gains.pass_rate)} of learners met the programme's competency pass threshold.`);
  if (data.cohort.total_post_completed > 0) achievements.push(`${data.cohort.total_post_completed} of ${data.cohort.total_enrolled} enrolled learners completed the full pre/post assessment cycle.`);
  drawNumberedList(doc, achievements.length > 0 ? achievements : ['No completed pre/post pairs yet for this cohort.']);

  drawSectionTitle(doc, 'Challenges');
  drawParagraph(doc, data.narrative.challenges);

  drawSectionTitle(doc, 'Next Steps');
  drawParagraph(doc, data.narrative.next_steps);
}
