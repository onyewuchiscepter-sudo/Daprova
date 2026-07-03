import crypto from 'node:crypto';
import { sql } from 'kysely';
import { db } from '../db/index.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { lockFrameworkIfNeeded } from './frameworkService.js';

async function resolveCohortByToken(cohortToken: string) {
  const cohort = await db
    .selectFrom('cohorts')
    .selectAll()
    .where((eb) => eb.or([eb('pre_link_token', '=', cohortToken), eb('post_link_token', '=', cohortToken)]))
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!cohort) throw notFound('Assessment link not found or has been invalidated');

  const sessionType: 'pre' | 'post' = cohort.pre_link_token === cohortToken ? 'pre' : 'post';
  return { cohort, sessionType };
}

type Demographics = { gender?: string; age_group?: string; location_type?: string; disability?: string };

export async function startSession(
  cohortToken: string,
  opts: { learner_token?: string; demographics?: Demographics; display_name?: string; enrolment_id?: string },
) {
  const { cohort, sessionType } = await resolveCohortByToken(cohortToken);

  let learner = opts.learner_token
    ? await db.selectFrom('learners').selectAll().where('learner_token', '=', opts.learner_token).where('cohort_id', '=', cohort.id).executeTakeFirst()
    : undefined;

  if (!learner) {
    // FR-M2-07: demographics are collected at pre-assessment only. A post-link
    // visit with no known learner_token means this browser/device has no
    // record of a pre-assessment — cross-device linking is a manual admin
    // action (US-08), not handled by this endpoint.
    if (sessionType === 'post') {
      throw badRequest('No learner record found for this device. Complete the pre-assessment first, or ask your admin to link your account.');
    }
    learner = await db
      .insertInto('learners')
      .values({
        cohort_id: cohort.id,
        learner_token: crypto.randomUUID(),
        display_name: opts.display_name ?? null,
        enrolment_id: opts.enrolment_id ?? null,
        gender: opts.demographics?.gender ?? null,
        age_group: opts.demographics?.age_group ?? null,
        location_type: opts.demographics?.location_type ?? null,
        disability: opts.demographics?.disability ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  let session = await db
    .selectFrom('assessment_sessions')
    .selectAll()
    .where('learner_id', '=', learner.id)
    .where('session_type', '=', sessionType)
    .executeTakeFirst();

  if (session?.status === 'completed') {
    throw conflict('This assessment has already been submitted', { learner_token: learner.learner_token });
  }

  if (!session) {
    session = await db
      .insertInto('assessment_sessions')
      .values({ learner_id: learner.id, cohort_id: cohort.id, session_type: sessionType })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // FR-M1-05: framework becomes immutable once the first assessment session begins.
  await lockFrameworkIfNeeded(cohort.framework_id);

  const questions = await db
    .selectFrom('questions')
    .innerJoin('competency_areas', 'competency_areas.id', 'questions.area_id')
    .select([
      'questions.id',
      'questions.area_id',
      'questions.question_text',
      'questions.option_a',
      'questions.option_b',
      'questions.option_c',
      'questions.option_d',
    ])
    .where('competency_areas.framework_id', '=', cohort.framework_id)
    .where('competency_areas.is_active', '=', true)
    .where('questions.is_active', '=', true)
    .where((eb) => eb.or([eb('questions.assessment_type', '=', sessionType), eb('questions.assessment_type', '=', 'both')]))
    .orderBy('competency_areas.display_order')
    .orderBy('questions.created_at')
    .execute();

  return { learner_token: learner.learner_token, session_id: session.id, session_type: sessionType, questions };
}

async function resolveLearnerSession(cohortToken: string, learnerToken: string) {
  const { cohort, sessionType } = await resolveCohortByToken(cohortToken);
  const learner = await db
    .selectFrom('learners')
    .selectAll()
    .where('learner_token', '=', learnerToken)
    .where('cohort_id', '=', cohort.id)
    .executeTakeFirst();
  if (!learner) throw notFound('Learner not found for this assessment link');

  const session = await db
    .selectFrom('assessment_sessions')
    .selectAll()
    .where('learner_id', '=', learner.id)
    .where('session_type', '=', sessionType)
    .executeTakeFirst();
  if (!session) throw notFound('No assessment session started — call /start first');

  return { cohort, learner, session };
}

type ResponseInput = { question_id: string; selected_option: 'a' | 'b' | 'c' | 'd' };

// Accepts either a single response or a batch (the admin-web/assessment-web
// client batches several answers per network round trip to cut down on 3G
// radio wake-ups — see assessment-web/app.js). Both shapes hit the same
// idempotent per-question upsert, so the documented single-response contract
// (spec B3.6) still works unchanged.
export async function recordResponses(cohortToken: string, learnerToken: string, responses: ResponseInput[]) {
  const { session } = await resolveLearnerSession(cohortToken, learnerToken);
  if (session.status === 'completed') throw conflict('Session already submitted, responses can no longer be recorded');

  for (const r of responses) {
    const question = await db
      .selectFrom('questions')
      .selectAll()
      .where('id', '=', r.question_id)
      .executeTakeFirst();
    if (!question) throw badRequest(`Unknown question_id: ${r.question_id}`);

    const isCorrect = question.correct_option === r.selected_option;
    await db
      .insertInto('question_responses')
      .values({ session_id: session.id, question_id: question.id, area_id: question.area_id, selected_option: r.selected_option, is_correct: isCorrect })
      .onConflict((oc) => oc.columns(['session_id', 'question_id']).doUpdateSet({ selected_option: r.selected_option, is_correct: isCorrect, answered_at: new Date() }))
      .execute();
  }

  return { ok: true };
}

type ConfidenceInput = { area_id: string; rating: number };

async function scoreSummaryFor(learnerId: string, frameworkId: string, resultSessionType: 'pre' | 'post') {
  const [pre, post] = await Promise.all([
    db.selectFrom('assessment_sessions').selectAll().where('learner_id', '=', learnerId).where('session_type', '=', 'pre').where('status', '=', 'completed').executeTakeFirst(),
    db.selectFrom('assessment_sessions').selectAll().where('learner_id', '=', learnerId).where('session_type', '=', 'post').where('status', '=', 'completed').executeTakeFirst(),
  ]);

  const areas = await db.selectFrom('competency_areas').selectAll().where('framework_id', '=', frameworkId).where('is_active', '=', true).orderBy('display_order').execute();

  const competencyBreakdown = await Promise.all(
    areas.map(async (area) => {
      const pct = async (sessionId: string | undefined) => {
        if (!sessionId) return null;
        // Postgres can't SUM() a boolean column — use a FILTER'd count instead.
        const row = await db
          .selectFrom('question_responses')
          .select(({ fn }) => [fn.countAll().as('total'), sql<string>`count(*) filter (where is_correct)`.as('correct')])
          .where('session_id', '=', sessionId)
          .where('area_id', '=', area.id)
          .executeTakeFirst();
        const total = Number(row?.total ?? 0);
        if (total === 0) return null;
        return Math.round((Number(row?.correct ?? 0) / total) * 10000) / 100;
      };
      return { area_name: area.name, pre_pct: await pct(pre?.id), post_pct: await pct(post?.id) };
    }),
  );

  const preScore = pre?.total_score !== undefined && pre?.total_score !== null ? Number(pre.total_score) : null;
  const postScore = post?.total_score !== undefined && post?.total_score !== null ? Number(post.total_score) : null;

  return {
    session_type: resultSessionType,
    total_score: resultSessionType === 'post' ? postScore : preScore,
    pre_score: preScore,
    post_score: postScore,
    gain: preScore !== null && postScore !== null ? Math.round((postScore - preScore) * 100) / 100 : null,
    competency_breakdown: competencyBreakdown,
  };
}

export async function submitSession(cohortToken: string, learnerToken: string, confidence?: ConfidenceInput[]) {
  const { cohort, learner, session } = await resolveLearnerSession(cohortToken, learnerToken);

  if (session.status === 'completed') {
    // Idempotent per spec B3.1 — duplicate submit calls return the existing result.
    return scoreSummaryFor(learner.id, cohort.framework_id, session.session_type as 'pre' | 'post');
  }

  const agg = await db
    .selectFrom('question_responses')
    .select(({ fn }) => [fn.countAll().as('total'), sql<string>`count(*) filter (where is_correct)`.as('correct')])
    .where('session_id', '=', session.id)
    .executeTakeFirst();
  const total = Number(agg?.total ?? 0);
  const totalScore = total > 0 ? Math.round((Number(agg?.correct ?? 0) / total) * 10000) / 100 : 0;
  const durationSecs = Math.round((Date.now() - new Date(session.started_at as unknown as string).getTime()) / 1000);

  await db
    .updateTable('assessment_sessions')
    .set({ status: 'completed', completed_at: new Date(), total_score: totalScore, duration_secs: durationSecs })
    .where('id', '=', session.id)
    .execute();

  if (confidence && confidence.length > 0) {
    await db
      .insertInto('confidence_ratings')
      .values(confidence.map((c) => ({ session_id: session.id, area_id: c.area_id, rating: c.rating })))
      .execute();
  }

  return scoreSummaryFor(learner.id, cohort.framework_id, session.session_type as 'pre' | 'post');
}

export async function getResult(cohortToken: string, learnerToken: string) {
  const { cohort } = await resolveCohortByToken(cohortToken);
  const learner = await db.selectFrom('learners').selectAll().where('learner_token', '=', learnerToken).where('cohort_id', '=', cohort.id).executeTakeFirst();
  if (!learner) throw notFound('Learner not found');

  const [pre, post] = await Promise.all([
    db.selectFrom('assessment_sessions').selectAll().where('learner_id', '=', learner.id).where('session_type', '=', 'pre').where('status', '=', 'completed').executeTakeFirst(),
    db.selectFrom('assessment_sessions').selectAll().where('learner_id', '=', learner.id).where('session_type', '=', 'post').where('status', '=', 'completed').executeTakeFirst(),
  ]);
  const latest = post ?? pre;
  if (!latest) throw notFound('No completed assessment session for this learner');

  return scoreSummaryFor(learner.id, cohort.framework_id, latest.session_type as 'pre' | 'post');
}
