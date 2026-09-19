import { sql } from 'kysely';
import { db } from '../db/index.js';
import { env } from '../env.js';
import { badRequest, notFound } from '../lib/errors.js';
import { brandingForCohort } from '../lib/branding.js';
import { emailConfigured, escapeHtml, sendEmails, sendSms, smsConfigured, whatsappLink } from '../lib/messaging.js';

// Nudging learners who haven't finished something: the post-assessment
// (the number funders judge a programme on), the satisfaction survey, or the
// tracer survey months later. Every message carries the learner's personal
// link (?l=<learner_token>), which also lets them finish on a different
// device from the one they started on.

export type ReminderKind = 'post' | 'satisfaction' | 'tracer';
export type ReminderChannel = 'email' | 'sms' | 'whatsapp';

// The same learner isn't sent the same reminder on the same channel twice
// within this window, however many times the button is pressed.
const COOLDOWN_HOURS = 20;

async function loadCohort(orgId: string, cohortId: string) {
  const cohort = await db
    .selectFrom('cohorts')
    .innerJoin('courses', 'courses.id', 'cohorts.course_id')
    .innerJoin('organisations', 'organisations.id', 'courses.org_id')
    .select([
      'cohorts.id',
      'cohorts.post_link_token',
      'cohorts.satisfaction_link_token',
      'cohorts.tracer_link_token',
      'courses.name as course_name',
      'organisations.name as org_name',
    ])
    .where('cohorts.id', '=', cohortId)
    .where('courses.org_id', '=', orgId)
    .where('cohorts.deleted_at', 'is', null)
    .executeTakeFirst();
  if (!cohort) throw notFound('Cohort not found');
  return cohort;
}

type CohortRow = Awaited<ReturnType<typeof loadCohort>>;

function personalLink(cohort: CohortRow, kind: ReminderKind, learnerToken: string) {
  const base = env.assessmentWebOrigin.replace(/\/$/, '');
  const path = kind === 'post' ? `assess/${cohort.post_link_token}` : kind === 'satisfaction' ? `satisfaction/${cohort.satisfaction_link_token}` : `tracer/${cohort.tracer_link_token}`;
  return `${base}/${path}?l=${learnerToken}`;
}

function firstName(name: string | null) {
  return (name ?? '').trim().split(/\s+/)[0] || 'there';
}

function messageText(cohort: CohortRow, kind: ReminderKind, name: string | null, link: string) {
  const hi = `Hi ${firstName(name)}`;
  if (kind === 'post') return `${hi}, ${cohort.org_name} here. Please take your ${cohort.course_name} final assessment (about 10 minutes) so we can see how much you've learned: ${link}`;
  if (kind === 'satisfaction') return `${hi}, how was ${cohort.course_name}? ${cohort.org_name} would love 2 minutes of feedback: ${link}`;
  return `${hi}, it's been a while since ${cohort.course_name}. Tell ${cohort.org_name} what's changed for you since (3 minutes): ${link}`;
}

const SUBJECTS: Record<ReminderKind, (c: CohortRow) => string> = {
  post: (c) => `Your ${c.course_name} final assessment`,
  satisfaction: (c) => `How was ${c.course_name}?`,
  tracer: (c) => `What's changed since ${c.course_name}?`,
};
const BUTTON: Record<ReminderKind, string> = { post: 'Take the assessment', satisfaction: 'Give feedback', tracer: 'Answer 5 questions' };

function emailHtml(cohort: CohortRow, kind: ReminderKind, text: string, link: string, color: string, logoUrl: string | null) {
  const intro = escapeHtml(text.slice(0, text.lastIndexOf(':')));
  const logo = logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(cohort.org_name)}" style="max-height:48px;max-width:180px;margin-bottom:16px">` : '';
  return `<!doctype html><html><body style="margin:0;background:#f1f4f2;font-family:Arial,sans-serif;color:#12212e">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px">
    <div style="background:#ffffff;border-radius:8px;padding:28px;border-top:4px solid ${color}">
      ${logo}
      <p style="font-size:16px;line-height:1.5;margin:0 0 20px">${intro}.</p>
      <p style="margin:0 0 24px"><a href="${escapeHtml(link)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:bold">${BUTTON[kind]}</a></p>
      <p style="font-size:12px;color:#5f736d;margin:0">This link is personal to you. If the button doesn't work, copy this into your browser:<br>${escapeHtml(link)}</p>
    </div>
    <p style="font-size:11px;color:#5f736d;text-align:center;margin-top:16px">Sent by ${escapeHtml(cohort.org_name)} via Daprova. You're receiving this because you shared your contact details when you enrolled.</p>
  </div></body></html>`;
}

// Learners a reminder of this kind applies to: those who started but haven't
// finished the step it's about.
async function eligibleLearners(cohortId: string, kind: ReminderKind) {
  const done = (type: 'pre' | 'post') =>
    sql<boolean>`exists (select 1 from assessment_sessions s where s.learner_id = l.id and s.session_type = ${type} and s.status in ('completed', 'flagged'))`;
  const condition =
    kind === 'post'
      ? sql<boolean>`${done('pre')} and not ${done('post')}`
      : kind === 'satisfaction'
        ? sql<boolean>`${done('post')} and not exists (select 1 from satisfaction_responses sr where sr.learner_id = l.id)`
        : sql<boolean>`${done('post')} and not exists (select 1 from tracer_responses tr where tr.learner_id = l.id)`;
  return db
    .selectFrom('learners as l')
    .select(['l.id', 'l.display_name', 'l.email', 'l.phone', 'l.contact_consent', 'l.learner_token'])
    .where('l.cohort_id', '=', cohortId)
    .where(condition)
    .orderBy('l.created_at')
    .execute();
}

async function lastReminders(learnerIds: string[], kind: ReminderKind) {
  if (!learnerIds.length) return new Map<string, { channel: string; created_at: Date }[]>();
  const rows = await db
    .selectFrom('learner_reminders')
    .select(['learner_id', 'channel', 'created_at'])
    .where('learner_id', 'in', learnerIds)
    .where('kind', '=', kind)
    .where('status', '=', 'sent')
    .orderBy('created_at', 'desc')
    .execute();
  const map = new Map<string, { channel: string; created_at: Date }[]>();
  for (const r of rows) map.set(r.learner_id, [...(map.get(r.learner_id) ?? []), { channel: r.channel, created_at: new Date(r.created_at as unknown as string) }]);
  return map;
}

function onCooldown(history: { channel: string; created_at: Date }[] | undefined, channel: ReminderChannel) {
  const last = history?.find((h) => h.channel === channel);
  return !!last && Date.now() - last.created_at.getTime() < COOLDOWN_HOURS * 3600 * 1000;
}

export async function getReminderCandidates(orgId: string, cohortId: string, kind: ReminderKind) {
  const cohort = await loadCohort(orgId, cohortId);
  const learners = await eligibleLearners(cohortId, kind);
  const history = await lastReminders(
    learners.map((l) => l.id),
    kind,
  );
  return {
    kind,
    channels: { email: emailConfigured(), sms: smsConfigured(), whatsapp: true },
    cooldown_hours: COOLDOWN_HOURS,
    learners: learners.map((l) => {
      const link = personalLink(cohort, kind, l.learner_token);
      const text = messageText(cohort, kind, l.display_name, link);
      const h = history.get(l.id);
      return {
        learner_id: l.id,
        display_name: l.display_name,
        has_email: !!(l.contact_consent && l.email),
        has_phone: !!(l.contact_consent && l.phone),
        last_reminded_at: h?.[0]?.created_at ?? null,
        reminder_count: h?.length ?? 0,
        whatsapp_url: l.contact_consent && l.phone ? whatsappLink(l.phone, text) : null,
        // Copyable for any learner, e.g. to share in a class WhatsApp group
        // one by one, even without stored contact details.
        personal_link: link,
      };
    }),
  };
}

export async function sendReminders(orgId: string, cohortId: string, kind: ReminderKind, channel: 'email' | 'sms', actorPersonId: string, learnerIds?: string[]) {
  if (channel === 'email' && !emailConfigured()) throw badRequest('Email sending is not set up yet (RESEND_API_KEY).');
  if (channel === 'sms' && !smsConfigured()) throw badRequest('SMS sending is not set up yet (TERMII_API_KEY).');

  const cohort = await loadCohort(orgId, cohortId);
  const branding = await brandingForCohort(orgId, cohortId);
  let learners = await eligibleLearners(cohortId, kind);
  if (learnerIds?.length) learners = learners.filter((l) => learnerIds.includes(l.id));
  const history = await lastReminders(
    learners.map((l) => l.id),
    kind,
  );

  const summary = { sent: 0, failed: 0, skipped_no_contact: 0, skipped_recent: 0, errors: [] as string[] };
  const targets = learners.filter((l) => {
    const contact = channel === 'email' ? l.email : l.phone;
    if (!l.contact_consent || !contact) {
      summary.skipped_no_contact++;
      return false;
    }
    if (onCooldown(history.get(l.id), channel)) {
      summary.skipped_recent++;
      return false;
    }
    return true;
  });
  if (!targets.length) return summary;

  // Email clients need an absolute URL for the org's logo.
  const logoUrl = branding.custom && branding.logoUrl && env.apiPublicUrl ? `${env.apiPublicUrl.replace(/\/$/, '')}${branding.logoUrl}` : null;
  const prepared = targets.map((l) => {
    const link = personalLink(cohort, kind, l.learner_token);
    return { learner: l, link, text: messageText(cohort, kind, l.display_name, link) };
  });

  const results =
    channel === 'email'
      ? await sendEmails(
          prepared.map((m) => ({
            to: m.learner.email as string,
            subject: SUBJECTS[kind](cohort),
            text: m.text,
            html: emailHtml(cohort, kind, m.text, m.link, branding.color, logoUrl),
          })),
        )
      : await Promise.all(prepared.map((m) => sendSms(m.learner.phone as string, m.text)));

  await db
    .insertInto('learner_reminders')
    .values(
      prepared.map((m, i) => {
        const r = results[i];
        return { cohort_id: cohortId, learner_id: m.learner.id, kind, channel, status: r.ok ? 'sent' : 'failed', error: r.ok ? null : r.error, sent_by: actorPersonId };
      }),
    )
    .execute();

  for (const r of results) {
    if (r.ok) summary.sent++;
    else {
      summary.failed++;
      if (!summary.errors.includes(r.error)) summary.errors.push(r.error);
    }
  }
  return summary;
}

// WhatsApp links are opened by the admin; this records that they did, so
// the "last reminded" column and cooldown stay accurate.
export async function logManualReminder(orgId: string, cohortId: string, learnerId: string, kind: ReminderKind, actorPersonId: string) {
  await loadCohort(orgId, cohortId);
  const learner = await db.selectFrom('learners').select('id').where('id', '=', learnerId).where('cohort_id', '=', cohortId).executeTakeFirst();
  if (!learner) throw notFound('Learner not found');
  await db.insertInto('learner_reminders').values({ cohort_id: cohortId, learner_id: learnerId, kind, channel: 'whatsapp', status: 'sent', sent_by: actorPersonId }).execute();
  return { ok: true };
}

export async function reminderHistory(orgId: string, cohortId: string) {
  await loadCohort(orgId, cohortId);
  return db
    .selectFrom('learner_reminders as r')
    .innerJoin('learners as l', 'l.id', 'r.learner_id')
    .select(['r.kind', 'r.channel', 'r.status', 'r.error', 'r.created_at', 'l.display_name'])
    .where('r.cohort_id', '=', cohortId)
    .orderBy('r.created_at', 'desc')
    .limit(100)
    .execute();
}
