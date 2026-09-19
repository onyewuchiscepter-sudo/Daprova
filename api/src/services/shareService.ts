import crypto from 'node:crypto';
import { sql } from 'kysely';
import { db } from '../db/index.js';
import { AppError, notFound } from '../lib/errors.js';
import { assertFeature, getOrgPlan } from './billing/index.js';
import { brandingForCohortId } from '../lib/branding.js';
import * as analyticsService from './analyticsService.js';

// Read-only public links a programme can hand to a funder: live results for
// one cohort, no login. Aggregates only — never learner names, individual
// scores, free-text comments or subgroups smaller than 5 people.

const MIN_GROUP = 5;

async function assertCohort(orgId: string, cohortId: string) {
  const row = await db
    .selectFrom('cohorts')
    .innerJoin('courses', 'courses.id', 'cohorts.course_id')
    .select('cohorts.id')
    .where('cohorts.id', '=', cohortId)
    .where('courses.org_id', '=', orgId)
    .where('cohorts.deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row) throw notFound('Cohort not found');
}

// Pricing spec §5 — live funder links are a plan feature, checked here
// (server side). Growth's "single funder view" is one active link per
// cohort; Scale and Enterprise allow one per funder.
export async function createShareLink(orgId: string, cohortId: string, label: string | undefined, actorPersonId: string) {
  await assertCohort(orgId, cohortId);
  const tier = await assertFeature(orgId, 'live_funder_monitoring_link');
  if (tier.features.live_funder_monitoring_link === 'single_funder_view') {
    const active = await db.selectFrom('cohort_share_links').select('id').where('cohort_id', '=', cohortId).where('revoked_at', 'is', null).executeTakeFirst();
    if (active) {
      throw new AppError(403, 'UPGRADE_REQUIRED', 'The Growth plan includes one live funder link per cohort — turn off the existing link first, or move to Scale for one per funder.', {
        code: 'UPGRADE_REQUIRED',
        feature: 'live_funder_monitoring_link',
        required_tier: 'scale',
      });
    }
  }
  return db
    .insertInto('cohort_share_links')
    .values({ cohort_id: cohortId, token: crypto.randomBytes(18).toString('base64url'), label: label?.trim() || null, created_by: actorPersonId })
    .returning(['id', 'token', 'label', 'created_at', 'view_count', 'last_viewed_at', 'revoked_at'])
    .executeTakeFirstOrThrow();
}

export async function listShareLinks(orgId: string, cohortId: string) {
  await assertCohort(orgId, cohortId);
  return db
    .selectFrom('cohort_share_links')
    .select(['id', 'token', 'label', 'created_at', 'view_count', 'last_viewed_at', 'revoked_at'])
    .where('cohort_id', '=', cohortId)
    .orderBy('created_at', 'desc')
    .execute();
}

export async function revokeShareLink(orgId: string, cohortId: string, linkId: string) {
  await assertCohort(orgId, cohortId);
  const row = await db
    .updateTable('cohort_share_links')
    .set({ revoked_at: sql`now()` })
    .where('id', '=', linkId)
    .where('cohort_id', '=', cohortId)
    .returning('id')
    .executeTakeFirst();
  if (!row) throw notFound('Share link not found');
  return { ok: true };
}

export async function getSharedCohort(token: string) {
  const link = await db
    .selectFrom('cohort_share_links as l')
    .innerJoin('cohorts as co', 'co.id', 'l.cohort_id')
    .innerJoin('courses as c', 'c.id', 'co.course_id')
    .innerJoin('organisations as o', 'o.id', 'c.org_id')
    .select(['l.id', 'co.id as cohort_id', 'co.name as cohort_name', 'co.start_date', 'co.end_date', 'co.pass_threshold', 'co.course_id', 'c.name as course_name', 'o.name as org_name', 'o.id as org_id'])
    .where('l.token', '=', token)
    .where('l.revoked_at', 'is', null)
    .where('co.deleted_at', 'is', null)
    .executeTakeFirst();
  if (!link) throw notFound('This link has expired or been turned off by the programme.');
  // Links stop working if the organisation's plan no longer includes them.
  const { tier } = await getOrgPlan(link.org_id);
  if (!tier.features.live_funder_monitoring_link) throw notFound('This link has expired or been turned off by the programme.');

  await db
    .updateTable('cohort_share_links')
    .set((eb) => ({ view_count: eb('view_count', '+', 1), last_viewed_at: sql`now()` }))
    .where('id', '=', link.id)
    .execute();

  const cohortId = link.cohort_id;
  const [branding, gains, cohensD, passRate, breakdown, selfRatings, satisfaction, outcomes, counts, ...equity] = await Promise.all([
    brandingForCohortId(cohortId),
    analyticsService.getMeanGain(cohortId),
    analyticsService.getCohensD(cohortId),
    analyticsService.getPassRate(cohortId, Number(link.pass_threshold)),
    analyticsService.getCompetencyBreakdown(cohortId, link.course_id),
    analyticsService.getSelfRatings(cohortId),
    analyticsService.getSatisfactionSummary(cohortId),
    analyticsService.getOutcomesSummary(cohortId),
    db
      .selectFrom('learners')
      .select(({ fn }) => [
        fn.countAll().as('enrolled'),
        sql<string>`count(*) filter (where exists (select 1 from assessment_sessions s where s.learner_id = learners.id and s.session_type = 'pre' and s.status = 'completed'))`.as('pre_completed'),
        sql<string>`count(*) filter (where exists (select 1 from assessment_sessions s where s.learner_id = learners.id and s.session_type = 'post' and s.status = 'completed'))`.as('post_completed'),
      ])
      .where('cohort_id', '=', cohortId)
      .executeTakeFirstOrThrow(),
    ...(['gender', 'location_type', 'age_group', 'disability'] as const).map((d) => analyticsService.getEquityBreakdown(cohortId, d)),
  ]);

  const dateOnly = (d: unknown) => (d ? new Date(d as string).toISOString().slice(0, 10) : null);

  return {
    org_name: link.org_name,
    course_name: link.course_name,
    cohort_name: link.cohort_name,
    start_date: dateOnly(link.start_date),
    end_date: dateOnly(link.end_date),
    branding: { custom: branding.custom, white_label: branding.whiteLabel, color: branding.color, logo_url: branding.logoUrl },
    participation: {
      enrolled: Number(counts.enrolled),
      pre_completed: Number(counts.pre_completed),
      post_completed: Number(counts.post_completed),
    },
    outcomes: {
      measured_learners: gains.n_learners,
      mean_pre: gains.mean_pre_score,
      mean_post: gains.mean_post_score,
      mean_gain: gains.mean_gain,
      pass_rate: passRate,
      pass_threshold: Number(link.pass_threshold),
      cohens_d: cohensD.cohens_d,
    },
    competency_breakdown: breakdown.map((a) => ({ area_name: a.area_name, pre_pct: a.pre_pct, post_pct: a.post_pct })),
    self_ratings: selfRatings.map((a) => ({ area_name: a.area_name, pre_avg: a.pre_avg, post_avg: a.post_avg })),
    equity: (tier.features.equity_dashboard ? equity : []).map((e) => ({
      dimension: e.dimension,
      groups: e.groups.filter((g) => g.n >= MIN_GROUP).map((g) => ({ label: g.label, n: g.n, mean_gain: g.mean_gain, pass_rate: g.pass_rate })),
      suppressed_groups: e.groups.filter((g) => g.n < MIN_GROUP).length,
    })),
    satisfaction:
      satisfaction.response_count >= MIN_GROUP
        ? {
            response_count: satisfaction.response_count,
            avg_instructor_rating: satisfaction.avg_instructor_rating,
            avg_content_relevance: satisfaction.avg_content_relevance,
            avg_delivery_satisfaction: satisfaction.avg_delivery_satisfaction,
            nps_score: satisfaction.nps_score,
          }
        : null,
    follow_up:
      tier.features.tracer_survey && outcomes.response_count >= MIN_GROUP
        ? {
            response_count: outcomes.response_count,
            employment: outcomes.employment,
            business: outcomes.business,
            income: outcomes.income,
            avg_training_contribution: outcomes.avg_training_contribution,
          }
        : null,
    generated_at: new Date().toISOString(),
  };
}
