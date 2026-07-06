import type { Paragraph, Table } from 'docx';
import type { ReportDataContract } from '../../../reportDataService.js';
import { formatPct, formatSigned, numberedList, paragraph, reportHeader, sectionTitle, table } from '../primitives.js';

export function renderGizUsaid(data: ReportDataContract): (Paragraph | Table)[] {
  return [
    ...reportHeader({
      templateTitle: 'GIZ / USAID — Results Framework Report',
      orgName: data.org.name,
      cohortName: data.cohort.name,
      courseName: data.cohort.course_name,
      dateRange: `${data.cohort.start_date ?? 'Start TBC'} – ${data.cohort.end_date ?? 'End TBC'}`,
    }),

    sectionTitle('Project Summary'),
    paragraph(data.narrative.background),

    sectionTitle('Output Indicators'),
    ...numberedList([
      `Total learners enrolled: ${data.cohort.total_enrolled}`,
      `Learners completing pre-assessment: ${data.cohort.total_pre_completed}`,
      `Learners completing post-assessment: ${data.cohort.total_post_completed}`,
    ]),

    sectionTitle('Outcome Indicators (Learning Gains)'),
    ...numberedList([
      `Mean learning gain: ${formatSigned(data.learning_gains.mean_gain, ' pts')}`,
      `Pass rate against competency threshold: ${formatPct(data.learning_gains.pass_rate)}`,
      `Effect size (Cohen's d): ${data.learning_gains.cohens_d?.toString() ?? '—'}`,
    ]),
    table(
      ['Competency area', 'Pre', 'Post', 'Gain'],
      data.learning_gains.competency_breakdown.map((a) => [a.area_name, formatPct(a.pre_pct), formatPct(a.post_pct), formatSigned(a.gain)]),
    ),

    sectionTitle('Disaggregated Results'),
    table(['Gender', 'n', 'Mean gain', 'Pass rate'], data.equity.by_gender.map((g) => [g.label.replace(/_/g, ' '), String(g.n), formatSigned(g.mean_gain), formatPct(g.pass_rate)])),
    table(['Location', 'n', 'Mean gain', 'Pass rate'], data.equity.by_location.map((g) => [g.label, String(g.n), formatSigned(g.mean_gain), formatPct(g.pass_rate)])),
    table(['Age group', 'n', 'Mean gain', 'Pass rate'], data.equity.by_age_group.map((g) => [g.label, String(g.n), formatSigned(g.mean_gain), formatPct(g.pass_rate)])),

    sectionTitle('Lessons Learned'),
    paragraph(data.narrative.challenges),
    sectionTitle('Recommendations / Next Steps'),
    paragraph(data.narrative.next_steps),
  ];
}
