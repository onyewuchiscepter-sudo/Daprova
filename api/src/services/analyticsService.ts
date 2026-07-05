import { sql } from 'kysely';
import { db } from '../db/index.js';

// US-13: the 4 demographic filters can be applied together (compound), and
// applying any of them updates every dashboard metric simultaneously — so
// getMeanGain/getPassRate/getCompetencyBreakdown all take this same shape.
export type DemographicFilters = { gender?: string; age_group?: string; location_type?: string; disability?: string };

function applyDemographicFilters<QB extends { where: (...args: any[]) => QB }>(qb: QB, learnerAlias: string, filters?: DemographicFilters): QB {
  let result = qb;
  if (filters?.gender) result = result.where(`${learnerAlias}.gender`, '=', filters.gender);
  if (filters?.age_group) result = result.where(`${learnerAlias}.age_group`, '=', filters.age_group);
  if (filters?.location_type) result = result.where(`${learnerAlias}.location_type`, '=', filters.location_type);
  if (filters?.disability) result = result.where(`${learnerAlias}.disability`, '=', filters.disability);
  return result;
}

// B4.1 — mean learning gain at cohort level.
export async function getMeanGain(cohortId: string, filters?: DemographicFilters) {
  let query = db
    .selectFrom('assessment_sessions as pre')
    .innerJoin('assessment_sessions as post', (join) =>
      join
        .onRef('pre.learner_id', '=', 'post.learner_id')
        .onRef('pre.cohort_id', '=', 'post.cohort_id')
        .on('pre.session_type', '=', 'pre')
        .on('post.session_type', '=', 'post')
        .on('pre.status', '=', 'completed')
        .on('post.status', '=', 'completed'),
    )
    .innerJoin('learners as l', 'l.id', 'pre.learner_id')
    .select(({ fn }) => [
      sql<string>`round(avg(post.total_score - pre.total_score)::numeric, 2)`.as('mean_gain'),
      sql<string>`round(avg(pre.total_score)::numeric, 2)`.as('mean_pre_score'),
      sql<string>`round(avg(post.total_score)::numeric, 2)`.as('mean_post_score'),
      fn.countAll().as('n_learners'),
    ])
    .where('pre.cohort_id', '=', cohortId);
  query = applyDemographicFilters(query, 'l', filters);
  const row = await query.executeTakeFirst();

  return {
    mean_gain: row?.mean_gain !== null && row?.mean_gain !== undefined ? Number(row.mean_gain) : null,
    mean_pre_score: row?.mean_pre_score !== null && row?.mean_pre_score !== undefined ? Number(row.mean_pre_score) : null,
    mean_post_score: row?.mean_post_score !== null && row?.mean_post_score !== undefined ? Number(row.mean_post_score) : null,
    n_learners: Number(row?.n_learners ?? 0),
  };
}

// US-11 — pass rate (% of learners whose post score meets the cohort's
// pass_threshold), needed alongside mean gain on the cohort dashboard.
export async function getPassRate(cohortId: string, passThreshold: number, filters?: DemographicFilters) {
  let query = db
    .selectFrom('assessment_sessions as pre')
    .innerJoin('assessment_sessions as post', (join) =>
      join
        .onRef('pre.learner_id', '=', 'post.learner_id')
        .onRef('pre.cohort_id', '=', 'post.cohort_id')
        .on('pre.session_type', '=', 'pre')
        .on('post.session_type', '=', 'post')
        .on('pre.status', '=', 'completed')
        .on('post.status', '=', 'completed'),
    )
    .innerJoin('learners as l', 'l.id', 'pre.learner_id')
    .select(({ fn }) => [
      sql<string>`count(*) filter (where post.total_score >= ${passThreshold})`.as('passed'),
      fn.countAll().as('total'),
    ])
    .where('pre.cohort_id', '=', cohortId);
  query = applyDemographicFilters(query, 'l', filters);
  const row = await query.executeTakeFirst();

  const total = Number(row?.total ?? 0);
  if (total === 0) return null;
  return Math.round((Number(row?.passed ?? 0) / total) * 1000) / 10;
}

// B4.1 — competency-level pre/post breakdown across the whole cohort
// (distinct from assessmentService's per-learner breakdown).
export async function getCompetencyBreakdown(cohortId: string, frameworkId: string, filters?: DemographicFilters) {
  let perLearnerArea = db
    .selectFrom('question_responses as qr')
    .innerJoin('assessment_sessions as s', 's.id', 'qr.session_id')
    .innerJoin('learners as l', 'l.id', 's.learner_id')
    .select([
      'qr.area_id',
      's.session_type',
      's.learner_id',
      sql<string>`count(*) filter (where qr.is_correct)`.as('correct'),
      ({ fn }) => fn.countAll().as('total'),
    ])
    .where('s.cohort_id', '=', cohortId)
    .where('s.status', '=', 'completed')
    .groupBy(['qr.area_id', 's.session_type', 's.learner_id']);
  perLearnerArea = applyDemographicFilters(perLearnerArea, 'l', filters);

  const rows = await db
    .selectFrom('competency_areas as ca')
    .innerJoin(perLearnerArea.as('qr_agg'), 'qr_agg.area_id', 'ca.id')
    .select([
      'ca.id as area_id',
      'ca.name as area_name',
      sql<string>`round(avg(case when qr_agg.session_type = 'pre' then (qr_agg.correct::float / qr_agg.total) * 100 end)::numeric, 2)`.as('pre_pct'),
      sql<string>`round(avg(case when qr_agg.session_type = 'post' then (qr_agg.correct::float / qr_agg.total) * 100 end)::numeric, 2)`.as('post_pct'),
    ])
    .where('ca.framework_id', '=', frameworkId)
    .groupBy(['ca.id', 'ca.name', 'ca.display_order'])
    .orderBy('ca.display_order')
    .execute();

  return rows.map((r) => ({
    area_id: r.area_id,
    area_name: r.area_name,
    pre_pct: r.pre_pct !== null ? Number(r.pre_pct) : null,
    post_pct: r.post_pct !== null ? Number(r.post_pct) : null,
  }));
}

// B4.1 — Cohen's d effect size. SQL fetches the raw stats; the calculation
// itself is application-layer per the spec ("Step 2: calculate in Node.js").
export async function getCohensD(cohortId: string, filters?: DemographicFilters) {
  let query = db
    .selectFrom('assessment_sessions as pre')
    .innerJoin('assessment_sessions as post', (join) =>
      join
        .onRef('pre.learner_id', '=', 'post.learner_id')
        .onRef('pre.cohort_id', '=', 'post.cohort_id')
        .on('pre.session_type', '=', 'pre')
        .on('post.session_type', '=', 'post')
        .on('pre.status', '=', 'completed')
        .on('post.status', '=', 'completed'),
    )
    .innerJoin('learners as l', 'l.id', 'pre.learner_id')
    .select([
      sql<string>`avg(post.total_score - pre.total_score)`.as('mean_gain'),
      sql<string>`stddev(pre.total_score)`.as('sd_pre'),
      sql<string>`stddev(post.total_score)`.as('sd_post'),
    ])
    .where('pre.cohort_id', '=', cohortId);
  query = applyDemographicFilters(query, 'l', filters);
  const row = await query.executeTakeFirst();

  if (!row || row.mean_gain === null) return { mean_gain: null, cohens_d: null };

  const meanGain = Number(row.mean_gain);
  const sdPre = Number(row.sd_pre ?? 0);
  const sdPost = Number(row.sd_post ?? 0);
  const pooledSd = Math.sqrt((sdPre ** 2 + sdPost ** 2) / 2);
  const cohensD = pooledSd > 0 ? meanGain / pooledSd : null;

  return { mean_gain: Math.round(meanGain * 100) / 100, cohens_d: cohensD !== null ? Math.round(cohensD * 1000) / 1000 : null };
}

const DIMENSIONS = ['gender', 'age_group', 'location_type', 'disability'] as const;
export type EquityDimension = (typeof DIMENSIONS)[number];

// B4.1 equity disaggregation (generic pattern), extended per FR-M3-01 to
// include confidence gain alongside mean pre/post/gain and pass rate.
// Deviating from the spec's literal SQL in one way: the reference query uses
// HAVING COUNT(*) >= 5 to suppress small subgroups entirely, but
// FR-M3-03/US-14 both require small subgroups to still be *shown*, just
// flagged as unreliable — so the n < 5 check happens in application code as
// a `small_sample` flag instead of a HAVING clause that would drop the row.
export async function getEquityBreakdown(cohortId: string, dimension: EquityDimension) {
  const rows = await db
    .selectFrom('learners as l')
    .innerJoin('assessment_sessions as pre', (join) =>
      join.onRef('l.id', '=', 'pre.learner_id').on('pre.session_type', '=', 'pre').on('pre.status', '=', 'completed'),
    )
    .innerJoin('assessment_sessions as post', (join) =>
      join.onRef('l.id', '=', 'post.learner_id').on('post.session_type', '=', 'post').on('post.status', '=', 'completed'),
    )
    .innerJoin('cohorts as co', 'co.id', 'l.cohort_id')
    .select([
      sql.ref(`l.${dimension}`).as('label'),
      ({ fn }) => fn.countAll().as('n'),
      sql<string>`round(avg(post.total_score - pre.total_score)::numeric, 2)`.as('mean_gain'),
      sql<string>`round(avg(pre.total_score)::numeric, 2)`.as('mean_pre'),
      sql<string>`round(avg(post.total_score)::numeric, 2)`.as('mean_post'),
      sql<string>`round(count(*) filter (where post.total_score >= co.pass_threshold)::numeric / count(*) * 100, 1)`.as('pass_rate'),
    ])
    .where('l.cohort_id', '=', cohortId)
    .where(sql.ref(`l.${dimension}`), 'is not', null)
    .groupBy(sql.ref(`l.${dimension}`))
    .orderBy(sql.ref(`l.${dimension}`))
    .execute();

  // Confidence gain isn't paired session-to-session like scores are (a
  // learner can rate confidence per area without that area needing a scored
  // response), so it's queried separately from confidence_ratings and merged
  // by label rather than folded into the join above.
  const confidenceRows = await db
    .selectFrom('confidence_ratings as cr')
    .innerJoin('assessment_sessions as s', 's.id', 'cr.session_id')
    .innerJoin('learners as l', 'l.id', 's.learner_id')
    .select([
      sql.ref(`l.${dimension}`).as('label'),
      sql<string>`round(avg(case when s.session_type = 'pre' then cr.rating end)::numeric, 2)`.as('mean_confidence_pre'),
      sql<string>`round(avg(case when s.session_type = 'post' then cr.rating end)::numeric, 2)`.as('mean_confidence_post'),
    ])
    .where('l.cohort_id', '=', cohortId)
    .where('s.status', '=', 'completed')
    .where(sql.ref(`l.${dimension}`), 'is not', null)
    .groupBy(sql.ref(`l.${dimension}`))
    .execute();
  const confidenceByLabel = new Map(confidenceRows.map((r) => [String(r.label), r]));

  return {
    dimension,
    groups: rows.map((r) => {
      const conf = confidenceByLabel.get(String(r.label));
      const confPre = conf?.mean_confidence_pre !== null && conf?.mean_confidence_pre !== undefined ? Number(conf.mean_confidence_pre) : null;
      const confPost = conf?.mean_confidence_post !== null && conf?.mean_confidence_post !== undefined ? Number(conf.mean_confidence_post) : null;
      return {
        label: String(r.label),
        n: Number(r.n),
        mean_gain: r.mean_gain !== null ? Number(r.mean_gain) : null,
        mean_pre: r.mean_pre !== null ? Number(r.mean_pre) : null,
        mean_post: r.mean_post !== null ? Number(r.mean_post) : null,
        pass_rate: r.pass_rate !== null ? Number(r.pass_rate) : null,
        confidence_gain: confPre !== null && confPost !== null ? Math.round((confPost - confPre) * 100) / 100 : null,
        small_sample: Number(r.n) < 5,
      };
    }),
  };
}
