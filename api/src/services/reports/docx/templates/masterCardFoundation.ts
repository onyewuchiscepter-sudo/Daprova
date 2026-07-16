import type { Paragraph, Table } from 'docx';
import type { ReportDataContract } from '../../../reportDataService.js';
import { formatPct, formatSigned, keyValueGrid, numberedList, paragraph, reportHeader, satisfactionSection, sectionTitle, table } from '../primitives.js';

export function renderMasterCardFoundation(data: ReportDataContract): (Paragraph | Table)[] {
  const achievements: string[] = [];
  if (data.learning_gains.mean_gain !== null) achievements.push(`Learners achieved a mean gain of ${formatSigned(data.learning_gains.mean_gain, ' pts')} between pre- and post-assessment.`);
  if (data.learning_gains.pass_rate !== null) achievements.push(`${formatPct(data.learning_gains.pass_rate)} of learners met the programme's competency pass threshold.`);
  if (data.cohort.total_post_completed > 0) achievements.push(`${data.cohort.total_post_completed} of ${data.cohort.total_enrolled} enrolled learners completed the full pre/post assessment cycle.`);

  return [
    ...reportHeader({
      templateTitle: 'MasterCard Foundation — Programme Impact Report',
      orgName: data.org.name,
      cohortName: data.cohort.name,
      courseName: data.cohort.course_name,
      dateRange: `${data.cohort.start_date ?? 'Start TBC'} – ${data.cohort.end_date ?? 'End TBC'}`,
    }),

    sectionTitle('Programme Overview'),
    keyValueGrid([
      ['Total enrolled', String(data.cohort.total_enrolled)],
      ['Pre-assessment completed', String(data.cohort.total_pre_completed)],
      ['Post-assessment completed', String(data.cohort.total_post_completed)],
      ['Mean learning gain', formatSigned(data.learning_gains.mean_gain, ' pts')],
    ]),

    sectionTitle('Theory of Change Alignment'),
    paragraph(data.narrative.background),

    sectionTitle('Learner Demographics'),
    table(
      ['Gender', 'n', 'Mean gain', 'Pass rate'],
      data.equity.by_gender.map((g) => [g.label.replace(/_/g, ' '), String(g.n), formatSigned(g.mean_gain), formatPct(g.pass_rate)]),
    ),

    sectionTitle('Pre/Post Learning Gains'),
    table(
      ['Metric', 'Value'],
      [
        ['Mean pre-assessment score', formatPct(data.learning_gains.mean_pre_score)],
        ['Mean post-assessment score', formatPct(data.learning_gains.mean_post_score)],
        ['Mean gain', formatSigned(data.learning_gains.mean_gain, ' pts')],
        ['Pass rate', formatPct(data.learning_gains.pass_rate)],
        ["Effect size (Cohen's d)", data.learning_gains.cohens_d?.toString() ?? '—'],
      ],
      [250, 150],
    ),
    table(
      ['Competency area', 'Pre', 'Post', 'Gain'],
      data.learning_gains.competency_breakdown.map((a) => [a.area_name, formatPct(a.pre_pct), formatPct(a.post_pct), formatSigned(a.gain)]),
    ),

    sectionTitle('Equity Breakdown'),
    table(['Location', 'n', 'Mean gain', 'Pass rate'], data.equity.by_location.map((g) => [g.label, String(g.n), formatSigned(g.mean_gain), formatPct(g.pass_rate)])),
    table(['Age group', 'n', 'Mean gain', 'Pass rate'], data.equity.by_age_group.map((g) => [g.label, String(g.n), formatSigned(g.mean_gain), formatPct(g.pass_rate)])),

    ...satisfactionSection('Learner Feedback', data.satisfaction),

    sectionTitle('Key Achievements'),
    ...numberedList(achievements.length > 0 ? achievements : ['No completed pre/post pairs yet for this cohort.']),

    sectionTitle('Challenges'),
    paragraph(data.narrative.challenges),

    sectionTitle('Next Steps'),
    paragraph(data.narrative.next_steps),
  ];
}
