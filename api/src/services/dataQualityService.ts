import { sql } from 'kysely';
import { db } from '../db/index.js';

const GAMING_THRESHOLD_SECS = 180;
const INCOMPLETE_THRESHOLD = 0.8;

// B4.2 — gaming + incomplete checks run inline "on submit"/"on session
// completion" per the spec's own detection-logic column. Returns the
// flag_reason and status to persist; the caller (assessmentService.submitSession)
// still returns a score summary to the learner either way (US-09 requires an
// immediate summary regardless of any quality flag — the flag only affects
// whether the session counts toward cohort-level analytics).
export async function evaluateSubmission(sessionId: string, frameworkId: string, sessionType: 'pre' | 'post', durationSecs: number) {
  if (durationSecs < GAMING_THRESHOLD_SECS) {
    return { flagReason: 'gaming' as const, status: 'completed' as const };
  }

  const [totalActive, answered] = await Promise.all([
    db
      .selectFrom('questions')
      .innerJoin('competency_areas', 'competency_areas.id', 'questions.area_id')
      .select(({ fn }) => fn.countAll().as('count'))
      .where('competency_areas.framework_id', '=', frameworkId)
      .where('competency_areas.is_active', '=', true)
      .where('questions.is_active', '=', true)
      .where((eb) => eb.or([eb('questions.assessment_type', '=', sessionType), eb('questions.assessment_type', '=', 'both')]))
      .executeTakeFirstOrThrow(),
    db.selectFrom('question_responses').select(({ fn }) => fn.countAll().as('count')).where('session_id', '=', sessionId).executeTakeFirstOrThrow(),
  ]);

  const total = Number(totalActive.count);
  const ratio = total > 0 ? Number(answered.count) / total : 1;
  if (ratio < INCOMPLETE_THRESHOLD) {
    return { flagReason: 'incomplete' as const, status: 'flagged' as const };
  }

  return { flagReason: null, status: 'completed' as const };
}

// B4.2 — outlier detection: "gain > mean_gain + 3*stddev for the cohort, run
// as a background job after cohort closes." No task-queue infra exists yet
// for a real scheduled job, so this is exposed as an admin-triggered action
// (POST /cohorts/:id/run-outlier-detection) that does the same computation on
// demand — same detection logic, different trigger mechanism.
export async function runOutlierDetection(cohortId: string) {
  const stats = await db
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
    .select([
      sql<string>`avg(post.total_score - pre.total_score)`.as('mean_gain'),
      sql<string>`stddev(post.total_score - pre.total_score)`.as('stddev_gain'),
    ])
    .where('pre.cohort_id', '=', cohortId)
    .executeTakeFirst();

  if (!stats || stats.mean_gain === null || stats.stddev_gain === null) return { flagged: 0 };

  const threshold = Number(stats.mean_gain) + 3 * Number(stats.stddev_gain);

  const outliers = await db
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
    .select(['post.id as post_session_id', 'post.flag_reason as existing_flag'])
    .where('pre.cohort_id', '=', cohortId)
    .where(sql<boolean>`(post.total_score - pre.total_score) > ${threshold}`)
    .execute();

  for (const o of outliers) {
    const nextFlag = o.existing_flag ? `${o.existing_flag},outlier` : 'outlier';
    await db.updateTable('assessment_sessions').set({ flag_reason: nextFlag }).where('id', '=', o.post_session_id).execute();
  }

  return { flagged: outliers.length };
}
