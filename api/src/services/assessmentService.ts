import crypto from 'node:crypto';
import { sql } from 'kysely';
import { db } from '../db/index.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { lockCourseIfNeeded } from './frameworkService.js';
import { evaluateSubmission } from './dataQualityService.js';
import { assertCapacityAvailable } from './pricingService.js';
import { brandingForCohortId } from '../lib/branding.js';

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
  opts: {
    learner_token?: string;
    demographics?: Demographics;
    display_name?: string;
    enrolment_id?: string;
    // Optional, only stored with consent — used for post-assessment
    // reminders and to send the learner their certificate.
    email?: string;
    phone?: string;
    contact_consent?: boolean;
  },
) {
  const { cohort, sessionType } = await resolveCohortByToken(cohortToken);

  let learner = opts.learner_token
    ? await db.selectFrom('learners').selectAll().where('learner_token', '=', opts.learner_token).where('cohort_id', '=', cohort.id).executeTakeFirst()
    : undefined;

  if (!learner) {
    // FR-M2-07: demographics are collected at pre-assessment only. A post-link
    // visit with no known learner_token means this browser/device has no
    // record of a pre-assessment. Reminder messages carry a personal link
    // (?l=<learner_token>) that fixes exactly this on any device.
    if (sessionType === 'post') {
      throw badRequest(
        "We couldn't find your pre-assessment on this device. Open the personal link from your reminder message, or ask your programme to resend it.",
      );
    }

    // A token this cohort doesn't know (e.g. left on a shared phone by a
    // learner from another programme) is not an enrolment: the page falls
    // back to the details form instead of creating a nameless learner.
    if (opts.learner_token && !opts.display_name) {
      throw notFound('No learner found for this link on this device.');
    }

    // docs/org-onboarding-spec.md §5.4 — a brand new learner is exactly the
    // "add a student to a cohort" action the plan's student cap gates.
    // Checked here rather than in the admin-facing cohort endpoints, since
    // this public link is the only place enrollment actually happens.
    await assertCapacityAvailable(cohort.id);

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
        email: opts.contact_consent ? (opts.email ?? null) : null,
        phone: opts.contact_consent ? (opts.phone ?? null) : null,
        contact_consent: !!opts.contact_consent && !!(opts.email || opts.phone),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await db
      .updateTable('cohorts')
      .set((eb) => ({ student_count: eb('student_count', '+', 1) }))
      .where('id', '=', cohort.id)
      .execute();
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

  // FR-M1-05: a course's structure becomes immutable once the first assessment session begins.
  await lockCourseIfNeeded(cohort.course_id);

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
      'questions.question_type',
      'questions.scenario_text',
    ])
    .where('competency_areas.course_id', '=', cohort.course_id)
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

// selected_option is a-d for multiple choice/scenario, a-b for true/false,
// and "1"-"5" for self-ratings.
type ResponseInput = { question_id: string; selected_option: string };

const VALID_OPTIONS: Record<string, string[]> = {
  mcq: ['a', 'b', 'c', 'd'],
  scenario: ['a', 'b', 'c', 'd'],
  true_false: ['a', 'b'],
  self_rating: ['1', '2', '3', '4', '5'],
};

// Accepts either a single response or a batch (the admin-web/assessment-web
// client batches several answers per network round trip to cut down on 3G
// radio wake-ups — see assessment-web/app.js). Both shapes hit the same
// idempotent per-question upsert, so the documented single-response contract
// (spec B3.6) still works unchanged.
export async function recordResponses(cohortToken: string, learnerToken: string, responses: ResponseInput[]) {
  const { session } = await resolveLearnerSession(cohortToken, learnerToken);
  if (session.status === 'completed') throw conflict('Session already submitted, responses can no longer be recorded');

  // Validate the whole batch first, then save it in one statement: a bad
  // answer can't leave half a batch saved, and a batch costs two queries
  // instead of two per answer (this runs on learners' 3G connections).
  // Only questions from this cohort's own course are accepted.
  const ids = [...new Set(responses.map((r) => r.question_id))];
  const questions = await db
    .selectFrom('questions')
    .innerJoin('competency_areas', 'competency_areas.id', 'questions.area_id')
    .innerJoin('cohorts', 'cohorts.course_id', 'competency_areas.course_id')
    .select(['questions.id', 'questions.area_id', 'questions.question_type', 'questions.correct_option'])
    .where('questions.id', 'in', ids)
    .where('cohorts.id', '=', session.cohort_id)
    .execute();
  const byId = new Map(questions.map((q) => [q.id, q]));

  const latest = new Map<string, ResponseInput>();
  for (const r of responses) latest.set(r.question_id, r); // last answer wins within a batch
  const rows = [...latest.values()].map((r) => {
    const question = byId.get(r.question_id);
    if (!question) throw badRequest(`Unknown question_id: ${r.question_id}`);
    const type = question.question_type ?? 'mcq';
    if (!(VALID_OPTIONS[type] ?? VALID_OPTIONS.mcq).includes(r.selected_option)) throw badRequest(`Invalid answer for question ${r.question_id}`);
    // Self-ratings are the learner's own view of their skill: recorded (and
    // reported separately), never counted towards a score.
    const isScored = type !== 'self_rating';
    return {
      session_id: session.id,
      question_id: question.id,
      area_id: question.area_id,
      selected_option: r.selected_option,
      is_correct: isScored && question.correct_option === r.selected_option,
      is_scored: isScored,
    };
  });

  await db
    .insertInto('question_responses')
    .values(rows)
    .onConflict((oc) =>
      oc.columns(['session_id', 'question_id']).doUpdateSet((eb) => ({
        selected_option: eb.ref('excluded.selected_option'),
        is_correct: eb.ref('excluded.is_correct'),
        is_scored: eb.ref('excluded.is_scored'),
        answered_at: new Date(),
      })),
    )
    .execute();

  return { ok: true };
}

type ConfidenceInput = { area_id: string; rating: number };

async function scoreSummaryFor(learnerId: string, courseId: string, resultSessionType: 'pre' | 'post') {
  // This is the learner's own result screen, not a cohort aggregate — a
  // session flagged 'incomplete' still gets shown to the learner who took
  // it (US-09 requires an immediate summary regardless). Cohort-level
  // analytics (analyticsService.ts) correctly filter strictly to status =
  // 'completed', excluding flagged sessions from aggregate metrics.
  const [pre, post] = await Promise.all([
    db.selectFrom('assessment_sessions').selectAll().where('learner_id', '=', learnerId).where('session_type', '=', 'pre').where('status', 'in', ['completed', 'flagged']).executeTakeFirst(),
    db.selectFrom('assessment_sessions').selectAll().where('learner_id', '=', learnerId).where('session_type', '=', 'post').where('status', 'in', ['completed', 'flagged']).executeTakeFirst(),
  ]);

  const areas = await db.selectFrom('competency_areas').selectAll().where('course_id', '=', courseId).where('is_active', '=', true).orderBy('display_order').execute();

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
          .where('is_scored', '=', true)
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

  if (session.status !== 'started') {
    // Idempotent per spec B3.1 — duplicate submit calls return the existing
    // result. Checked against "not started" rather than "completed" because
    // an incomplete session is submitted once already too (status='flagged').
    return scoreSummaryFor(learner.id, cohort.course_id, session.session_type as 'pre' | 'post');
  }

  const agg = await db
    .selectFrom('question_responses')
    .select(({ fn }) => [fn.countAll().as('total'), sql<string>`count(*) filter (where is_correct)`.as('correct')])
    .where('session_id', '=', session.id)
    .where('is_scored', '=', true)
    .executeTakeFirst();
  const total = Number(agg?.total ?? 0);
  const totalScore = total > 0 ? Math.round((Number(agg?.correct ?? 0) / total) * 10000) / 100 : 0;
  const durationSecs = Math.round((Date.now() - new Date(session.started_at as unknown as string).getTime()) / 1000);

  const quality = await evaluateSubmission(session.id, cohort.course_id, session.session_type as 'pre' | 'post', durationSecs);

  await db
    .updateTable('assessment_sessions')
    .set({ status: quality.status, completed_at: new Date(), total_score: totalScore, duration_secs: durationSecs, flag_reason: quality.flagReason })
    .where('id', '=', session.id)
    .execute();

  if (confidence && confidence.length > 0) {
    await db
      .insertInto('confidence_ratings')
      .values(confidence.map((c) => ({ session_id: session.id, area_id: c.area_id, rating: c.rating })))
      .execute();
  }

  return scoreSummaryFor(learner.id, cohort.course_id, session.session_type as 'pre' | 'post');
}

export async function getResult(cohortToken: string, learnerToken: string) {
  const { cohort } = await resolveCohortByToken(cohortToken);
  const learner = await db.selectFrom('learners').selectAll().where('learner_token', '=', learnerToken).where('cohort_id', '=', cohort.id).executeTakeFirst();
  if (!learner) throw notFound('Learner not found');

  const [pre, post] = await Promise.all([
    db.selectFrom('assessment_sessions').selectAll().where('learner_id', '=', learner.id).where('session_type', '=', 'pre').where('status', 'in', ['completed', 'flagged']).executeTakeFirst(),
    db.selectFrom('assessment_sessions').selectAll().where('learner_id', '=', learner.id).where('session_type', '=', 'post').where('status', 'in', ['completed', 'flagged']).executeTakeFirst(),
  ]);
  const latest = post ?? pre;
  if (!latest) throw notFound('No completed assessment session for this learner');

  return scoreSummaryFor(learner.id, cohort.course_id, latest.session_type as 'pre' | 'post');
}

type SatisfactionInput = {
  instructor_rating: number;
  content_relevance: number;
  delivery_satisfaction: number;
  nps_score: number;
  open_positive?: string;
  open_improve?: string;
};

// Module 5 (S11) — its own shareable link (like pre_link_token/post_link_token),
// not chained onto the post-assessment flow — an org may send this out on its
// own schedule, so it deliberately doesn't check assessment_sessions at all,
// just that the learner belongs to this cohort.
async function resolveCohortBySatisfactionToken(cohortToken: string) {
  const cohort = await db
    .selectFrom('cohorts')
    .selectAll()
    .where('satisfaction_link_token', '=', cohortToken)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!cohort) throw notFound('Satisfaction survey link not found or has been invalidated');
  return cohort;
}

// A learner who never opened this exact link before (e.g. it was shared
// separately from the pre/post links, or on a different device) has no
// learner_token in this device's localStorage yet — enrolment_id is the one
// piece of identifying info every learner already gave at pre-assessment, so
// it's the lookup key here rather than collecting a fresh identity.
export async function identifyLearnerForSatisfaction(cohortToken: string, enrolmentId: string) {
  const cohort = await resolveCohortBySatisfactionToken(cohortToken);
  return identifyInCohort(cohort.id, enrolmentId);
}

async function identifyInCohort(cohortId: string, enrolmentId: string) {
  const cohort = { id: cohortId };
  const learner = await db
    .selectFrom('learners')
    .selectAll()
    .where('cohort_id', '=', cohort.id)
    .where('enrolment_id', '=', enrolmentId)
    .executeTakeFirst();
  if (!learner) throw notFound("We couldn't find that enrolment ID for this program.");
  return { learner_token: learner.learner_token };
}

// Upserted rather than insert-only since a learner can revisit the link, and
// a resubmission (e.g. after a network retry, or genuinely changing their
// answer) should overwrite rather than duplicate.
export async function submitSatisfaction(cohortToken: string, learnerToken: string, input: SatisfactionInput) {
  const cohort = await resolveCohortBySatisfactionToken(cohortToken);
  const learner = await db
    .selectFrom('learners')
    .selectAll()
    .where('learner_token', '=', learnerToken)
    .where('cohort_id', '=', cohort.id)
    .executeTakeFirst();
  if (!learner) throw notFound('Learner not found for this link');

  const existing = await db
    .selectFrom('satisfaction_responses')
    .select('id')
    .where('learner_id', '=', learner.id)
    .where('cohort_id', '=', cohort.id)
    .executeTakeFirst();

  const values = {
    instructor_rating: input.instructor_rating,
    content_relevance: input.content_relevance,
    delivery_satisfaction: input.delivery_satisfaction,
    nps_score: input.nps_score,
    open_positive: input.open_positive ?? null,
    open_improve: input.open_improve ?? null,
  };

  if (existing) {
    await db.updateTable('satisfaction_responses').set(values).where('id', '=', existing.id).execute();
  } else {
    await db.insertInto('satisfaction_responses').values({ learner_id: learner.id, cohort_id: cohort.id, ...values }).execute();
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Tracer survey (Module 6): its own link, sent 3-6 months after the course,
// asking what changed. Same identify-by-enrolment-ID flow as satisfaction.

async function resolveCohortByTracerToken(cohortToken: string) {
  const cohort = await db.selectFrom('cohorts').selectAll().where('tracer_link_token', '=', cohortToken).where('deleted_at', 'is', null).executeTakeFirst();
  if (!cohort) throw notFound('Follow-up survey link not found or has been invalidated');
  return cohort;
}

export async function identifyLearnerForTracer(cohortToken: string, enrolmentId: string) {
  const cohort = await resolveCohortByTracerToken(cohortToken);
  return identifyInCohort(cohort.id, enrolmentId);
}

export type TracerInput = {
  employment_status: string;
  business_status: string;
  income_change: string;
  skill_usage: string;
  training_contribution: number;
  open_challenge?: string;
};

export async function submitTracer(cohortToken: string, learnerToken: string, input: TracerInput) {
  const cohort = await resolveCohortByTracerToken(cohortToken);
  const learner = await db.selectFrom('learners').select('id').where('learner_token', '=', learnerToken).where('cohort_id', '=', cohort.id).executeTakeFirst();
  if (!learner) throw notFound('Learner not found for this link');

  const values = {
    employment_status: input.employment_status,
    business_status: input.business_status,
    income_change: input.income_change,
    skill_usage: input.skill_usage,
    training_contribution: input.training_contribution,
    open_challenge: input.open_challenge ?? null,
  };
  await db
    .insertInto('tracer_responses')
    .values({ learner_id: learner.id, cohort_id: cohort.id, survey_wave: 1, ...values })
    .onConflict((oc) => oc.columns(['learner_id', 'cohort_id', 'survey_wave']).doUpdateSet({ ...values, updated_at: sql`now()` }))
    .execute();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// What a learner-facing page needs before anything else: which kind of link
// it was opened with, whose programme it is, and (for Growth+ cohorts) the
// org's branding.
export async function getLinkInfo(token: string) {
  const cohort = await db
    .selectFrom('cohorts')
    .innerJoin('courses', 'courses.id', 'cohorts.course_id')
    .innerJoin('organisations', 'organisations.id', 'courses.org_id')
    .select([
      'cohorts.id',
      'cohorts.name as cohort_name',
      'cohorts.pre_link_token',
      'cohorts.post_link_token',
      'cohorts.satisfaction_link_token',
      'cohorts.tracer_link_token',
      'courses.name as course_name',
      'organisations.name as org_name',
    ])
    .where((eb) =>
      eb.or([
        eb('cohorts.pre_link_token', '=', token),
        eb('cohorts.post_link_token', '=', token),
        eb('cohorts.satisfaction_link_token', '=', token),
        eb('cohorts.tracer_link_token', '=', token),
      ]),
    )
    .where('cohorts.deleted_at', 'is', null)
    .executeTakeFirst();
  if (!cohort) throw notFound('This link is not valid or has been replaced — ask your programme for a new one.');

  const kind =
    cohort.pre_link_token === token ? 'pre' : cohort.post_link_token === token ? 'post' : cohort.satisfaction_link_token === token ? 'satisfaction' : 'tracer';
  const branding = await brandingForCohortId(cohort.id);
  return {
    kind,
    org_name: cohort.org_name,
    course_name: cohort.course_name,
    cohort_name: cohort.cohort_name,
    branding: { custom: branding.custom, color: branding.color, logo_url: branding.logoUrl },
  };
}
