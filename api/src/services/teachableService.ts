import { db } from '../db/index.js';

// B6.1 step 5 (optional): "Teachable sends course completion webhook ...
// Daprova sends post-assessment reminder link to learners who completed the
// course but not the assessment."
//
// Real Teachable webhook payloads aren't available to test against (no real
// Teachable account per the agreed MVP scope), so this defines a minimal,
// reasonable contract of our own: { cohort_id, enrolment_id }, matching a
// learner via the enrolment_id captured at pre-assessment time.
//
// Scope boundary: this computes *whether* a reminder is owed and returns
// that decision — it doesn't dispatch an actual email/SMS, since no
// notification channel (SendGrid/Twilio) exists in this MVP. A real
// implementation would hand this off to that channel; here it's logged.
export async function handleCourseCompletion(cohortId: string, enrolmentId: string) {
  const learner = await db
    .selectFrom('learners')
    .selectAll()
    .where('cohort_id', '=', cohortId)
    .where('enrolment_id', '=', enrolmentId)
    .executeTakeFirst();

  if (!learner) {
    return { matched: false, reminder_needed: false };
  }

  const postSession = await db
    .selectFrom('assessment_sessions')
    .selectAll()
    .where('learner_id', '=', learner.id)
    .where('session_type', '=', 'post')
    .where('status', '=', 'completed')
    .executeTakeFirst();

  const reminderNeeded = !postSession;
  if (reminderNeeded) {
    // Stand-in for actually sending the reminder (no email/SMS provider in this MVP).
    console.log(`[teachable-webhook] reminder owed: learner ${learner.id} (enrolment_id=${enrolmentId}) completed the course but not the post-assessment`);
  }

  return { matched: true, learner_id: learner.id, reminder_needed: reminderNeeded };
}
