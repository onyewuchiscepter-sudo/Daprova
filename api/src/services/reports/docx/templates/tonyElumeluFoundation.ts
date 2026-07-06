import type { Paragraph, Table } from 'docx';
import type { ReportDataContract } from '../../../reportDataService.js';
import { formatPct, formatSigned, keyValueGrid, paragraph, reportHeader, sectionTitle, table } from '../primitives.js';

export function renderTonyElumeluFoundation(data: ReportDataContract): (Paragraph | Table)[] {
  return [
    ...reportHeader({
      templateTitle: 'Tony Elumelu Foundation — Entrepreneur Development Report',
      orgName: data.org.name,
      cohortName: data.cohort.name,
      courseName: data.cohort.course_name,
      dateRange: `${data.cohort.start_date ?? 'Start TBC'} – ${data.cohort.end_date ?? 'End TBC'}`,
    }),

    sectionTitle('Entrepreneur Profile'),
    table(
      ['Gender', 'n', 'Pass rate'],
      data.equity.by_gender.map((g) => [g.label.replace(/_/g, ' '), String(g.n), formatPct(g.pass_rate)]),
    ),

    sectionTitle('Training Overview'),
    keyValueGrid([
      ['Total enrolled', String(data.cohort.total_enrolled)],
      ['Completed training cycle', String(data.cohort.total_post_completed)],
      ['Pre-assessment completed', String(data.cohort.total_pre_completed)],
      ['Mean learning gain', formatSigned(data.learning_gains.mean_gain, ' pts')],
    ]),

    sectionTitle('Skills Acquired (Competency Scores)'),
    table(
      ['Competency area', 'Pre', 'Post', 'Gain'],
      data.learning_gains.competency_breakdown.map((a) => [a.area_name, formatPct(a.pre_pct), formatPct(a.post_pct), formatSigned(a.gain)]),
    ),

    sectionTitle('Business Readiness Score'),
    paragraph(
      'Business readiness is approximated using learners\' self-reported confidence across competency areas, on a 1 (not confident) to 5 (very confident) scale.',
    ),
    keyValueGrid([
      ['Confidence — pre-training', data.learning_gains.mean_confidence_pre?.toString() ?? '—'],
      ['Confidence — post-training', data.learning_gains.mean_confidence_post?.toString() ?? '—'],
      [
        'Confidence gain',
        data.learning_gains.mean_confidence_pre !== null && data.learning_gains.mean_confidence_post !== null
          ? formatSigned(Math.round((data.learning_gains.mean_confidence_post - data.learning_gains.mean_confidence_pre) * 100) / 100)
          : '—',
      ],
    ]),

    sectionTitle('Next Steps'),
    paragraph(data.narrative.next_steps),
  ];
}
