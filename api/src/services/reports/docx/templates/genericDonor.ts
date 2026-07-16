import type { Paragraph, Table } from 'docx';
import type { ReportDataContract } from '../../../reportDataService.js';
import { formatPct, formatSigned, keyValueGrid, paragraph, reportHeader, satisfactionSection, sectionTitle, table } from '../primitives.js';

export function renderGenericDonor(data: ReportDataContract): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = [
    ...reportHeader({
      templateTitle: 'Programme Impact Report',
      orgName: data.org.name,
      cohortName: data.cohort.name,
      courseName: data.cohort.course_name,
      dateRange: `${data.cohort.start_date ?? 'Start TBC'} – ${data.cohort.end_date ?? 'End TBC'}`,
    }),

    sectionTitle('Executive Summary'),
    paragraph(data.narrative.background),

    sectionTitle('Programme Data'),
    keyValueGrid([
      ['Total enrolled', String(data.cohort.total_enrolled)],
      ['Pre-assessment completed', String(data.cohort.total_pre_completed)],
      ['Post-assessment completed', String(data.cohort.total_post_completed)],
      ['Mean learning gain', formatSigned(data.learning_gains.mean_gain, ' pts')],
    ]),

    sectionTitle('Learning Outcomes'),
    table(
      ['Metric', 'Value'],
      [
        ['Mean pre-assessment score', formatPct(data.learning_gains.mean_pre_score)],
        ['Mean post-assessment score', formatPct(data.learning_gains.mean_post_score)],
        ['Pass rate', formatPct(data.learning_gains.pass_rate)],
      ],
      [250, 150],
    ),
    table(
      ['Competency area', 'Pre', 'Post', 'Gain'],
      data.learning_gains.competency_breakdown.map((a) => [a.area_name, formatPct(a.pre_pct), formatPct(a.post_pct), formatSigned(a.gain)]),
    ),

    sectionTitle('Equity Outcomes'),
    table(['Gender', 'n', 'Mean gain', 'Pass rate'], data.equity.by_gender.map((g) => [g.label.replace(/_/g, ' '), String(g.n), formatSigned(g.mean_gain), formatPct(g.pass_rate)])),
    table(['Location', 'n', 'Mean gain', 'Pass rate'], data.equity.by_location.map((g) => [g.label, String(g.n), formatSigned(g.mean_gain), formatPct(g.pass_rate)])),

    ...satisfactionSection('Learner Satisfaction', data.satisfaction),

    sectionTitle('Recommendations'),
    paragraph(data.narrative.next_steps),
  ];

  if (data.narrative.challenges) {
    children.push(sectionTitle('Challenges Faced'));
    children.push(paragraph(data.narrative.challenges));
  }

  return children;
}
