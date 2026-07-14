import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { assignTierForNewCohort, checkCapacity } from './pricingService.js';

export async function createCourse(orgId: string, opts: { name: string; category: string }) {
  return db.insertInto('courses').values({ org_id: orgId, name: opts.name, category: opts.category }).returningAll().executeTakeFirstOrThrow();
}

export async function listCourses(orgId: string) {
  return db
    .selectFrom('courses')
    .selectAll()
    .where('org_id', '=', orgId)
    .where('deleted_at', 'is', null)
    .orderBy('created_at', 'desc')
    .execute();
}

async function assertCourseOwnership(orgId: string, courseId: string) {
  const course = await db
    .selectFrom('courses')
    .selectAll()
    .where('id', '=', courseId)
    .where('org_id', '=', orgId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!course) throw notFound('Course not found');
  return course;
}

export async function getCourse(orgId: string, courseId: string) {
  return assertCourseOwnership(orgId, courseId);
}

export async function createCohort(
  orgId: string,
  userId: string,
  courseId: string,
  opts: {
    name: string;
    framework_id: string;
    start_date?: string;
    end_date?: string;
    pass_threshold?: number;
    projected_student_count?: number;
  },
) {
  await assertCourseOwnership(orgId, courseId);

  const framework = await db
    .selectFrom('competency_frameworks')
    .selectAll()
    .where('id', '=', opts.framework_id)
    .where('org_id', '=', orgId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!framework) throw badRequest('framework_id does not reference a framework owned by this org');

  // Ordinal per org (docs/org-onboarding-spec.md §4.4) — drives free-trial
  // eligibility indirectly via has_used_free_trial, not read directly here.
  const existingCount = await db
    .selectFrom('cohorts')
    .innerJoin('courses', 'courses.id', 'cohorts.course_id')
    .select(({ fn }) => fn.countAll().as('count'))
    .where('courses.org_id', '=', orgId)
    .executeTakeFirstOrThrow();
  const cohortNumber = Number(existingCount.count) + 1;

  const cohort = await db
    .insertInto('cohorts')
    .values({
      course_id: courseId,
      framework_id: opts.framework_id,
      name: opts.name,
      start_date: opts.start_date ? new Date(opts.start_date) : null,
      end_date: opts.end_date ? new Date(opts.end_date) : null,
      pre_link_token: crypto.randomUUID(),
      post_link_token: crypto.randomUUID(),
      pass_threshold: opts.pass_threshold ?? 60,
      created_by: userId,
      cohort_number: cohortNumber,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  // Pricing assignment (Sprint 4) — the actual admin-facing cohort-creation
  // form doesn't collect a student estimate yet (that's Sprint 5/6's
  // signup-flow scope), so a rough default of 1 is used when the caller
  // doesn't supply one; real enrollment still gets capped correctly via
  // checkCapacity as students are actually added.
  const { tier, isFreeTrial, cohortStatus } = await assignTierForNewCohort(orgId, cohort.id, opts.projected_student_count ?? 1);
  const updated = await db
    .updateTable('cohorts')
    .set({ plan_tier_at_creation: tier.tier_id, is_free_trial: isFreeTrial, status: cohortStatus === 'pending_manual_quote' ? 'pending_manual_quote' : cohort.status })
    .where('id', '=', cohort.id)
    .returningAll()
    .executeTakeFirstOrThrow();

  return updated;
}

export async function listCohorts(orgId: string, courseId: string) {
  await assertCourseOwnership(orgId, courseId);
  return db
    .selectFrom('cohorts')
    .selectAll()
    .where('course_id', '=', courseId)
    .where('deleted_at', 'is', null)
    .orderBy('created_at', 'desc')
    .execute();
}

async function assertCohortOwnership(orgId: string, cohortId: string) {
  const cohort = await db
    .selectFrom('cohorts')
    .innerJoin('courses', 'courses.id', 'cohorts.course_id')
    .selectAll('cohorts')
    .where('cohorts.id', '=', cohortId)
    .where('courses.org_id', '=', orgId)
    .where('cohorts.deleted_at', 'is', null)
    .executeTakeFirst();
  if (!cohort) throw notFound('Cohort not found');
  return cohort;
}

export async function getCohort(orgId: string, cohortId: string) {
  const cohort = await assertCohortOwnership(orgId, cohortId);

  const [enrolled, preCompleted, postCompleted] = await Promise.all([
    db.selectFrom('learners').select(({ fn }) => fn.countAll().as('count')).where('cohort_id', '=', cohortId).executeTakeFirstOrThrow(),
    db
      .selectFrom('assessment_sessions')
      .select(({ fn }) => fn.countAll().as('count'))
      .where('cohort_id', '=', cohortId)
      .where('session_type', '=', 'pre')
      .where('status', '=', 'completed')
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('assessment_sessions')
      .select(({ fn }) => fn.countAll().as('count'))
      .where('cohort_id', '=', cohortId)
      .where('session_type', '=', 'post')
      .where('status', '=', 'completed')
      .executeTakeFirstOrThrow(),
  ]);

  // docs/org-onboarding-spec.md §5.4 — "warn at 90% of cap" needs an actual
  // reader to be meaningful; the cohort detail view is the natural place
  // since the admin dashboard already fetches it per cohort.
  const capacity = await checkCapacity(cohortId);

  return {
    ...cohort,
    total_enrolled: Number(enrolled.count),
    pre_completed: Number(preCompleted.count),
    post_completed: Number(postCompleted.count),
    capacity_status: capacity.status,
    max_students: capacity.maxStudents,
  };
}

export async function updateCohort(
  orgId: string,
  cohortId: string,
  opts: { start_date?: string; end_date?: string; graduation_date?: string; status?: string },
) {
  await assertCohortOwnership(orgId, cohortId);
  const patch: Record<string, unknown> = {};
  if (opts.start_date !== undefined) patch.start_date = new Date(opts.start_date);
  if (opts.end_date !== undefined) patch.end_date = new Date(opts.end_date);
  if (opts.graduation_date !== undefined) patch.graduation_date = new Date(opts.graduation_date);
  if (opts.status !== undefined) patch.status = opts.status;

  return db.updateTable('cohorts').set(patch).where('id', '=', cohortId).returningAll().executeTakeFirstOrThrow();
}

export async function listCohortLearners(orgId: string, cohortId: string) {
  await assertCohortOwnership(orgId, cohortId);

  const learners = await db.selectFrom('learners').selectAll().where('cohort_id', '=', cohortId).orderBy('created_at').execute();
  const sessions = await db
    .selectFrom('assessment_sessions')
    .select(['learner_id', 'session_type', 'status', 'total_score'])
    .where('cohort_id', '=', cohortId)
    .execute();

  return learners.map((l) => {
    const pre = sessions.find((s) => s.learner_id === l.id && s.session_type === 'pre');
    const post = sessions.find((s) => s.learner_id === l.id && s.session_type === 'post');
    return {
      learner_id: l.id,
      display_name: l.display_name,
      enrolment_id: l.enrolment_id,
      gender: l.gender,
      age_group: l.age_group,
      location_type: l.location_type,
      disability: l.disability,
      pre_status: pre?.status ?? 'not_started',
      post_status: post?.status ?? 'not_started',
      pre_score: pre?.total_score ?? null,
      post_score: post?.total_score ?? null,
    };
  });
}

// US-06: admin can regenerate a link, invalidating the old one.
export async function regenerateLinkToken(orgId: string, cohortId: string, type: 'pre' | 'post') {
  await assertCohortOwnership(orgId, cohortId);
  const newToken = crypto.randomUUID();
  const column = type === 'pre' ? 'pre_link_token' : 'post_link_token';
  return db.updateTable('cohorts').set({ [column]: newToken }).where('id', '=', cohortId).returningAll().executeTakeFirstOrThrow();
}
