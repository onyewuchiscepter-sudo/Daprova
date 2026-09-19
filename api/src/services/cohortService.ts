import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { assertCanCreateCohort, getOrgPlan, onCohortCreated } from './billing/index.js';
import * as frameworkService from './frameworkService.js';

// Three ways to create a course, matching the Framework -> Course hierarchy
// (docs/org-onboarding-spec.md's framework/course restructure): pick a
// template (clones a framework + its one course together), attach a new
// course to an existing org framework, or start both fresh from scratch.
export async function createCourse(
  orgId: string,
  userId: string,
  opts: { name: string; category?: string; templateId?: string; frameworkId?: string },
) {
  if (opts.templateId) {
    return frameworkService.cloneTemplateForNewCourse(orgId, userId, opts.templateId, opts.name);
  }
  if (opts.frameworkId) {
    return frameworkService.createCourseUnderExistingFramework(orgId, opts.frameworkId, opts.name);
  }
  if (!opts.category) throw badRequest('category is required when starting a course from scratch');
  return frameworkService.createCourseFromScratch(orgId, userId, opts.name, opts.category);
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

export async function getCourse(orgId: string, courseId: string) {
  return frameworkService.assertCourseOwnership(orgId, courseId);
}

export async function createCohort(
  orgId: string,
  userId: string,
  courseId: string,
  opts: {
    name: string;
    start_date?: string;
    end_date?: string;
    pass_threshold?: number;
    projected_student_count?: number;
  },
) {
  await frameworkService.assertCourseOwnership(orgId, courseId);
  // Pricing spec §3/§7: Enterprise sales gate, overdue invoices, and the
  // plan's concurrent-cohort limit — checked before anything is created.
  await assertCanCreateCohort(orgId);

  // Ordinal per org (docs/org-onboarding-spec.md §4.4).
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
      name: opts.name,
      start_date: opts.start_date ? new Date(opts.start_date) : null,
      end_date: opts.end_date ? new Date(opts.end_date) : null,
      pre_link_token: crypto.randomUUID(),
      post_link_token: crypto.randomUUID(),
      satisfaction_link_token: crypto.randomUUID(),
      pass_threshold: opts.pass_threshold ?? 60,
      created_by: userId,
      cohort_number: cohortNumber,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  // The org's first cohort is its free trial; otherwise this may start
  // billing and (per-cohort-cycle orgs) invoice the cycle's base fee.
  const { free_trial } = await onCohortCreated(orgId, cohort.id);
  return { ...cohort, is_free_trial: free_trial };
}

export async function listCohorts(orgId: string, courseId: string) {
  await frameworkService.assertCourseOwnership(orgId, courseId);
  return db
    .selectFrom('cohorts')
    .selectAll()
    .where('course_id', '=', courseId)
    .where('deleted_at', 'is', null)
    .orderBy('created_at', 'desc')
    .execute();
}

// Every cohort in the org across all its courses, for the top-level Cohorts page.
export async function listOrgCohorts(orgId: string) {
  return db
    .selectFrom('cohorts')
    .innerJoin('courses', 'courses.id', 'cohorts.course_id')
    .select(['cohorts.id', 'cohorts.name', 'cohorts.status', 'cohorts.created_at', 'courses.id as course_id', 'courses.name as course_name'])
    .where('courses.org_id', '=', orgId)
    .where('courses.deleted_at', 'is', null)
    .where('cohorts.deleted_at', 'is', null)
    .orderBy('cohorts.created_at', 'desc')
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

  // The org's plan (pricing is per organisation): which cohort features are
  // unlocked, so the page can show upgrade prompts instead of dead ends.
  const { tier } = await getOrgPlan(orgId);
  const plan = { tier_id: tier.tier_id, name: tier.display_name, features: tier.features, assessment_fee_per_learner_ngn: tier.assessment_fee_per_learner_ngn };

  return {
    ...cohort,
    plan,
    total_enrolled: Number(enrolled.count),
    pre_completed: Number(preCompleted.count),
    post_completed: Number(postCompleted.count),
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
      email: l.email,
      phone: l.phone,
      certificate_code: l.certificate_code,
      pre_status: pre?.status ?? 'not_started',
      post_status: post?.status ?? 'not_started',
      pre_score: pre?.total_score ?? null,
      post_score: post?.total_score ?? null,
    };
  });
}

// US-06: admin can regenerate a link, invalidating the old one.
export async function regenerateLinkToken(orgId: string, cohortId: string, type: 'pre' | 'post' | 'satisfaction' | 'tracer') {
  await assertCohortOwnership(orgId, cohortId);
  const newToken = crypto.randomUUID();
  const column = type === 'pre' ? 'pre_link_token' : type === 'post' ? 'post_link_token' : type === 'tracer' ? 'tracer_link_token' : 'satisfaction_link_token';
  return db.updateTable('cohorts').set({ [column]: newToken }).where('id', '=', cohortId).returningAll().executeTakeFirstOrThrow();
}
