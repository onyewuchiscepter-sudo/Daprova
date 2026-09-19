import { sql } from 'kysely';
import { db } from '../db/index.js';
import { notFound } from '../lib/errors.js';

// Cross-cohort views: the org home dashboard and cohort-vs-cohort
// comparison. One query computes every cohort's headline numbers; both
// views are shaped from it.

export type CohortMetrics = {
  cohort_id: string;
  cohort_name: string;
  course_id: string;
  course_name: string;
  status: string;
  created_at: string;
  start_date: string | null;
  enrolled: number;
  pre_completed: number;
  post_completed: number;
  pairs: number; // learners with both pre and post completed
  mean_pre: number | null;
  mean_post: number | null;
  mean_gain: number | null;
  pass_rate: number | null;
  reports: number;
  satisfaction_responses: number;
  tracer_responses: number;
};

type Row = {
  cohort_id: string;
  cohort_name: string;
  course_id: string;
  course_name: string;
  status: string;
  created_at: Date;
  start_date: Date | null;
  enrolled: string;
  pre_completed: string;
  post_completed: string;
  pairs: string;
  mean_pre: string | null;
  mean_post: string | null;
  mean_gain: string | null;
  passed: string;
  reports: string;
  satisfaction_responses: string;
  tracer_responses: string;
};

const num = (v: string | null) => (v === null ? null : Math.round(Number(v) * 100) / 100);

export async function cohortMetrics(orgId: string, courseId?: string): Promise<CohortMetrics[]> {
  const courseFilter = courseId ? sql`and c.id = ${courseId}` : sql``;
  const { rows } = await sql<Row>`
    with pairs as (
      select pre.cohort_id, pre.total_score as pre_score, post.total_score as post_score, co.pass_threshold
      from assessment_sessions pre
      join assessment_sessions post
        on post.learner_id = pre.learner_id and post.cohort_id = pre.cohort_id
       and post.session_type = 'post' and post.status = 'completed'
      join cohorts co on co.id = pre.cohort_id
      where pre.session_type = 'pre' and pre.status = 'completed'
    )
    select
      co.id as cohort_id, co.name as cohort_name, c.id as course_id, c.name as course_name,
      co.status, co.created_at, co.start_date,
      (select count(*) from learners l where l.cohort_id = co.id) as enrolled,
      (select count(*) from assessment_sessions s where s.cohort_id = co.id and s.session_type = 'pre' and s.status = 'completed') as pre_completed,
      (select count(*) from assessment_sessions s where s.cohort_id = co.id and s.session_type = 'post' and s.status = 'completed') as post_completed,
      (select count(*) from pairs p where p.cohort_id = co.id) as pairs,
      (select avg(p.pre_score) from pairs p where p.cohort_id = co.id) as mean_pre,
      (select avg(p.post_score) from pairs p where p.cohort_id = co.id) as mean_post,
      (select avg(p.post_score - p.pre_score) from pairs p where p.cohort_id = co.id) as mean_gain,
      (select count(*) from pairs p where p.cohort_id = co.id and p.post_score >= p.pass_threshold) as passed,
      (select count(*) from cohort_reports r where r.cohort_id = co.id) as reports,
      (select count(*) from satisfaction_responses sr where sr.cohort_id = co.id) as satisfaction_responses,
      (select count(*) from tracer_responses tr where tr.cohort_id = co.id) as tracer_responses
    from cohorts co
    join courses c on c.id = co.course_id
    where c.org_id = ${orgId} and co.deleted_at is null and c.deleted_at is null ${courseFilter}
    order by co.created_at
  `.execute(db);

  return rows.map((r) => {
    const pairs = Number(r.pairs);
    return {
      cohort_id: r.cohort_id,
      cohort_name: r.cohort_name,
      course_id: r.course_id,
      course_name: r.course_name,
      status: r.status,
      created_at: new Date(r.created_at).toISOString(),
      start_date: r.start_date ? new Date(r.start_date).toISOString().slice(0, 10) : null,
      enrolled: Number(r.enrolled),
      pre_completed: Number(r.pre_completed),
      post_completed: Number(r.post_completed),
      pairs,
      mean_pre: num(r.mean_pre),
      mean_post: num(r.mean_post),
      mean_gain: num(r.mean_gain),
      pass_rate: pairs ? Math.round((Number(r.passed) / pairs) * 1000) / 10 : null,
      reports: Number(r.reports),
      satisfaction_responses: Number(r.satisfaction_responses),
      tracer_responses: Number(r.tracer_responses),
    };
  });
}

type Attention = { cohort_id: string; cohort_name: string; kind: 'no_learners' | 'post_missing' | 'report_ready' | 'locked' | 'tracer_due'; message: string };

const DAY = 24 * 3600 * 1000;

// Things on the home page an admin should act on, most useful first.
function attentionItems(cohorts: CohortMetrics[]): Attention[] {
  const items: Attention[] = [];
  for (const c of cohorts) {
    if (c.status === 'closed') continue;
    const missing = c.pre_completed - c.post_completed;
    if (c.status === 'locked_pending_upgrade') {
      items.push({ cohort_id: c.cohort_id, cohort_name: c.cohort_name, kind: 'locked', message: 'Locked until the upgrade payment clears.' });
    } else if (c.enrolled === 0) {
      items.push({ cohort_id: c.cohort_id, cohort_name: c.cohort_name, kind: 'no_learners', message: 'No learners yet — share the pre-assessment link.' });
    } else if (missing >= 3 && c.post_completed < c.pre_completed * 0.8) {
      items.push({ cohort_id: c.cohort_id, cohort_name: c.cohort_name, kind: 'post_missing', message: `${missing} learners haven't taken the post-assessment — send a reminder.` });
    }
    if (c.pairs >= 5 && c.reports === 0) {
      items.push({ cohort_id: c.cohort_id, cohort_name: c.cohort_name, kind: 'report_ready', message: `Results for ${c.pairs} learners are in — generate a funder report.` });
    }
    const age = Date.now() - new Date(c.created_at).getTime();
    if (c.pairs >= 5 && c.tracer_responses === 0 && age > 90 * DAY) {
      items.push({ cohort_id: c.cohort_id, cohort_name: c.cohort_name, kind: 'tracer_due', message: 'Three months on — send the follow-up survey to capture outcomes.' });
    }
  }
  const order = { locked: 0, post_missing: 1, report_ready: 2, tracer_due: 3, no_learners: 4 };
  return items.sort((a, b) => order[a.kind] - order[b.kind]).slice(0, 8);
}

export async function orgOverview(orgId: string) {
  const cohorts = await cohortMetrics(orgId);
  const sum = (k: keyof CohortMetrics) => cohorts.reduce((acc, c) => acc + (c[k] as number), 0);
  const pairs = sum('pairs');
  // Learner-weighted averages across cohorts (not an average of averages).
  const weighted = (k: 'mean_gain' | 'mean_pre' | 'mean_post') =>
    pairs ? Math.round((cohorts.reduce((acc, c) => acc + (c[k] ?? 0) * c.pairs, 0) / pairs) * 100) / 100 : null;
  const passed = cohorts.reduce((acc, c) => acc + ((c.pass_rate ?? 0) / 100) * c.pairs, 0);

  const recentReports = await db
    .selectFrom('cohort_reports')
    .innerJoin('cohorts', 'cohorts.id', 'cohort_reports.cohort_id')
    .innerJoin('courses', 'courses.id', 'cohorts.course_id')
    .select(['cohort_reports.id', 'cohort_reports.funder_template', 'cohort_reports.generated_at', 'cohorts.id as cohort_id', 'cohorts.name as cohort_name'])
    .where('courses.org_id', '=', orgId)
    .orderBy('cohort_reports.generated_at', 'desc')
    .limit(5)
    .execute();

  return {
    totals: {
      cohorts: cohorts.length,
      active_cohorts: cohorts.filter((c) => c.status !== 'closed' && c.status !== 'graduated').length,
      learners: sum('enrolled'),
      pre_completed: sum('pre_completed'),
      post_completed: sum('post_completed'),
      measured_learners: pairs,
      mean_pre: weighted('mean_pre'),
      mean_post: weighted('mean_post'),
      mean_gain: weighted('mean_gain'),
      pass_rate: pairs ? Math.round((passed / pairs) * 1000) / 10 : null,
      reports: sum('reports'),
    },
    attention: attentionItems(cohorts),
    cohorts,
    recent_reports: recentReports,
  };
}

export async function courseComparison(orgId: string, courseId: string) {
  const course = await db.selectFrom('courses').select(['id', 'name']).where('id', '=', courseId).where('org_id', '=', orgId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!course) throw notFound('Course not found');
  return { course, cohorts: await cohortMetrics(orgId, courseId) };
}
