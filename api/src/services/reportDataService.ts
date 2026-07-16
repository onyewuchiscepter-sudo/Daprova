import { db } from '../db/index.js';
import { notFound } from '../lib/errors.js';
import * as analyticsService from './analyticsService.js';
import type { EquityDimension } from './analyticsService.js';

export type NarrativeFields = { background: string; challenges: string; next_steps: string };

// B7.2 — the exact data shape every funder template renders from. Fields
// that can't be computed (no satisfaction/tracer data — Modules 5/6 aren't
// built) are null, not omitted, so every template can safely branch on them.
export type ReportDataContract = {
  org: { name: string; logo_url: string | null };
  cohort: {
    name: string;
    course_name: string;
    start_date: string | null;
    end_date: string | null;
    total_enrolled: number;
    total_pre_completed: number;
    total_post_completed: number;
  };
  learning_gains: {
    mean_pre_score: number | null;
    mean_post_score: number | null;
    mean_gain: number | null;
    pass_rate: number | null;
    cohens_d: number | null;
    mean_confidence_pre: number | null;
    mean_confidence_post: number | null;
    competency_breakdown: Array<{ area_name: string; pre_pct: number | null; post_pct: number | null; gain: number | null }>;
  };
  equity: {
    by_gender: Array<{ label: string; n: number; mean_gain: number | null; pass_rate: number | null }>;
    by_location: Array<{ label: string; n: number; mean_gain: number | null; pass_rate: number | null }>;
    by_age_group: Array<{ label: string; n: number; mean_gain: number | null; pass_rate: number | null }>;
  };
  // Module 5 (S11) — null means no survey responses at all yet, so every
  // template can just skip the section rather than rendering an empty one.
  satisfaction: {
    response_count: number;
    avg_instructor_rating: number | null;
    avg_content_relevance: number | null;
    avg_delivery_satisfaction: number | null;
    nps_score: number | null;
    nps_promoters: number;
    nps_passives: number;
    nps_detractors: number;
    top_comments: string[];
  } | null;
  tracer: null; // Module 6 (tracer study) isn't built yet.
  narrative: NarrativeFields;
};

function toDateString(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function equitySide(cohortId: string, dimension: EquityDimension) {
  const { groups } = await analyticsService.getEquityBreakdown(cohortId, dimension);
  return groups.map((g) => ({ label: g.label, n: g.n, mean_gain: g.mean_gain, pass_rate: g.pass_rate }));
}

export async function buildReportDataContract(orgId: string, cohortId: string, narrative: NarrativeFields): Promise<ReportDataContract> {
  const cohort = await db
    .selectFrom('cohorts')
    .innerJoin('courses', 'courses.id', 'cohorts.course_id')
    .innerJoin('organisations', 'organisations.id', 'courses.org_id')
    .select([
      'cohorts.id as cohort_id',
      'cohorts.name as cohort_name',
      'cohorts.start_date',
      'cohorts.end_date',
      'cohorts.framework_id',
      'cohorts.pass_threshold',
      'courses.name as course_name',
      'organisations.id as org_id',
      'organisations.name as org_name',
      'organisations.logo_url',
    ])
    .where('cohorts.id', '=', cohortId)
    .where('organisations.id', '=', orgId)
    .where('cohorts.deleted_at', 'is', null)
    .executeTakeFirst();
  if (!cohort) throw notFound('Cohort not found');

  const [enrolled, preCompleted, postCompleted] = await Promise.all([
    db.selectFrom('learners').select(({ fn }) => fn.countAll().as('count')).where('cohort_id', '=', cohortId).executeTakeFirstOrThrow(),
    db.selectFrom('assessment_sessions').select(({ fn }) => fn.countAll().as('count')).where('cohort_id', '=', cohortId).where('session_type', '=', 'pre').where('status', '=', 'completed').executeTakeFirstOrThrow(),
    db.selectFrom('assessment_sessions').select(({ fn }) => fn.countAll().as('count')).where('cohort_id', '=', cohortId).where('session_type', '=', 'post').where('status', '=', 'completed').executeTakeFirstOrThrow(),
  ]);

  const passThreshold = Number(cohort.pass_threshold);
  const [gains, effectSize, competencyBreakdown, passRate, byGender, byLocation, byAgeGroup, confidence, satisfaction] = await Promise.all([
    analyticsService.getMeanGain(cohortId),
    analyticsService.getCohensD(cohortId),
    analyticsService.getCompetencyBreakdown(cohortId, cohort.framework_id),
    analyticsService.getPassRate(cohortId, passThreshold),
    equitySide(cohortId, 'gender'),
    equitySide(cohortId, 'location_type'),
    equitySide(cohortId, 'age_group'),
    analyticsService.getMeanConfidence(cohortId),
    analyticsService.getSatisfactionSummary(cohortId),
  ]);

  // A handful of representative quotes rather than every comment — reports
  // are meant to be skimmable, not a full transcript dump. Positive quotes
  // lead (funder reports read better opening with what's working), capped at
  // 5 combined so this section can't balloon with a large cohort.
  const topComments = satisfaction.comments
    .flatMap((c) => [c.positive, c.improve].filter((t): t is string => !!t))
    .slice(0, 5);

  return {
    org: { name: cohort.org_name, logo_url: cohort.logo_url },
    cohort: {
      name: cohort.cohort_name,
      course_name: cohort.course_name,
      start_date: toDateString(cohort.start_date),
      end_date: toDateString(cohort.end_date),
      total_enrolled: Number(enrolled.count),
      total_pre_completed: Number(preCompleted.count),
      total_post_completed: Number(postCompleted.count),
    },
    learning_gains: {
      mean_pre_score: gains.mean_pre_score,
      mean_post_score: gains.mean_post_score,
      mean_gain: gains.mean_gain,
      pass_rate: passRate,
      cohens_d: effectSize.cohens_d,
      mean_confidence_pre: confidence.mean_confidence_pre,
      mean_confidence_post: confidence.mean_confidence_post,
      competency_breakdown: competencyBreakdown.map((a) => ({
        area_name: a.area_name,
        pre_pct: a.pre_pct,
        post_pct: a.post_pct,
        gain: a.pre_pct !== null && a.post_pct !== null ? Math.round((a.post_pct - a.pre_pct) * 100) / 100 : null,
      })),
    },
    equity: { by_gender: byGender, by_location: byLocation, by_age_group: byAgeGroup },
    satisfaction:
      satisfaction.response_count === 0
        ? null
        : {
            response_count: satisfaction.response_count,
            avg_instructor_rating: satisfaction.avg_instructor_rating,
            avg_content_relevance: satisfaction.avg_content_relevance,
            avg_delivery_satisfaction: satisfaction.avg_delivery_satisfaction,
            nps_score: satisfaction.nps_score,
            nps_promoters: satisfaction.nps_promoters,
            nps_passives: satisfaction.nps_passives,
            nps_detractors: satisfaction.nps_detractors,
            top_comments: topComments,
          },
    tracer: null,
    narrative,
  };
}
