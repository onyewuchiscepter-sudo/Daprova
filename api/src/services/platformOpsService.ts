import crypto from 'node:crypto';
import { sql } from 'kysely';
import { db } from '../db/index.js';
import { env } from '../env.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { writeAuditLog } from '../lib/auditLog.js';
import { firebaseAuth } from '../lib/firebaseAdmin.js';
import { emailConfigured, escapeHtml, sendEmails } from '../lib/messaging.js';
import { inviteMember } from './orgTeamService.js';
import { BLOCK_AFTER_OVERDUE_DAYS } from './billing/invoices.js';
import { loadOrgBilling, orgTier } from './billing/plan.js';

// The platform console's operational tools: revenue overview, invoices
// across every org, platform staff, the activity log, discounts/credits,
// account fixes, and announcements. Every change is audit-logged.

const naira = (v: number) => `₦${v.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

export async function me(personId: string) {
  const row = await db
    .selectFrom('platform_admins')
    .innerJoin('people', 'people.id', 'platform_admins.person_id')
    .select(['people.id', 'people.email', 'people.display_name', 'platform_admins.platform_role'])
    .where('platform_admins.person_id', '=', personId)
    .executeTakeFirstOrThrow();
  return row;
}

// ---------------------------------------------------------------- overview

export async function overview() {
  const money = await db
    .selectFrom('invoices')
    .select([
      sql<string>`coalesce(sum(total_ngn) filter (where status = 'paid' and paid_at >= date_trunc('month', now())), 0)`.as('paid_this_month'),
      sql<string>`coalesce(sum(total_ngn) filter (where status = 'paid' and paid_at >= date_trunc('month', now()) - interval '1 month' and paid_at < date_trunc('month', now())), 0)`.as('paid_last_month'),
      sql<string>`coalesce(sum(total_ngn) filter (where status = 'paid' and paid_at >= date_trunc('year', now())), 0)`.as('paid_this_year'),
      sql<string>`coalesce(sum(total_ngn) filter (where status = 'paid'), 0)`.as('paid_all_time'),
      sql<string>`coalesce(sum(total_ngn) filter (where status = 'pending'), 0)`.as('pending_total'),
      sql<string>`count(*) filter (where status = 'pending')`.as('pending_count'),
      sql<string>`coalesce(sum(total_ngn) filter (where status = 'overdue'), 0)`.as('overdue_total'),
      sql<string>`count(*) filter (where status = 'overdue')`.as('overdue_count'),
      sql<string>`count(distinct org_id) filter (where status in ('pending','overdue') and due_date < now() - make_interval(days => ${BLOCK_AFTER_OVERDUE_DAYS}))`.as('blocked_orgs'),
    ])
    .where('deleted_at', 'is', null)
    .executeTakeFirstOrThrow();

  const monthly = await db
    .selectFrom('invoices')
    .select([sql<string>`to_char(date_trunc('month', paid_at), 'YYYY-MM')`.as('month'), sql<string>`sum(total_ngn)`.as('total')])
    .where('status', '=', 'paid')
    .where('deleted_at', 'is', null)
    .where('paid_at', '>=', sql<Date>`date_trunc('month', now()) - interval '5 months'`)
    .groupBy(sql`date_trunc('month', paid_at)`)
    .orderBy(sql`date_trunc('month', paid_at)`)
    .execute();

  const orgs = await db
    .selectFrom('organisations')
    .select(['id', 'pricing_tier', 'billing_status', 'verification_status', 'billing_frequency', 'billing_started_at', 'created_at'])
    .where('deleted_at', 'is', null)
    .execute();

  const byTier: Record<string, number> = { starter: 0, growth: 0, scale: 0, enterprise: 0 };
  const byStatus: Record<string, number> = {};
  let inTrial = 0;
  let newLast30 = 0;
  let mrr = 0;
  const monthAgo = Date.now() - 30 * 86400000;
  for (const o of orgs) {
    byTier[o.pricing_tier] = (byTier[o.pricing_tier] ?? 0) + 1;
    byStatus[o.billing_status] = (byStatus[o.billing_status] ?? 0) + 1;
    if (!o.billing_started_at) inTrial++;
    if (new Date(o.created_at as unknown as string).getTime() >= monthAgo) newLast30++;
    // Recurring base fees only (monthly orgs that are past their trial);
    // assessment fees and per-cycle fees depend on cohorts, not the calendar.
    if (o.billing_frequency === 'monthly' && o.billing_started_at && o.billing_status === 'active') {
      const tier = await orgTier(await loadOrgBilling(o.id));
      mrr += tier.base_fee_monthly_ngn ?? 0;
    }
  }

  const usage = await db
    .selectFrom('assessment_sessions')
    .select(sql<string>`count(distinct learner_id)`.as('learners'))
    .where('status', 'in', ['completed', 'flagged'])
    .where('completed_at', '>=', sql<Date>`now() - interval '30 days'`)
    .executeTakeFirstOrThrow();
  const cohorts30 = await db
    .selectFrom('cohorts')
    .select(sql<string>`count(*)`.as('n'))
    .where(sql<boolean>`created_at >= now() - interval '30 days'`)
    .where('deleted_at', 'is', null)
    .executeTakeFirstOrThrow();
  const reports30 = await db
    .selectFrom('cohort_reports')
    .select(sql<string>`count(*)`.as('n'))
    .where(sql<boolean>`generated_at >= now() - interval '30 days'`)
    .executeTakeFirstOrThrow();
  const flags = await db.selectFrom('signup_fraud_flags').select(sql<string>`count(*)`.as('n')).where('reviewed_at', 'is', null).executeTakeFirstOrThrow();

  const n = (v: string) => Number(v);
  return {
    revenue: {
      paid_this_month: n(money.paid_this_month),
      paid_last_month: n(money.paid_last_month),
      paid_this_year: n(money.paid_this_year),
      paid_all_time: n(money.paid_all_time),
      monthly_recurring: mrr,
      by_month: monthly.map((m) => ({ month: m.month, total: n(m.total) })),
    },
    receivables: {
      pending_total: n(money.pending_total),
      pending_count: n(money.pending_count),
      overdue_total: n(money.overdue_total),
      overdue_count: n(money.overdue_count),
      blocked_orgs: n(money.blocked_orgs),
      block_after_days: BLOCK_AFTER_OVERDUE_DAYS,
    },
    orgs: {
      total: orgs.length,
      by_tier: byTier,
      by_billing_status: byStatus,
      in_trial: inTrial,
      new_last_30_days: newLast30,
      awaiting_verification: orgs.filter((o) => o.verification_status === 'pending').length,
    },
    usage_last_30_days: { learners_assessed: n(usage.learners), cohorts_created: n(cohorts30.n), reports_generated: n(reports30.n) },
    to_review: { fraud_flags: n(flags.n) },
  };
}

// ---------------------------------------------------------------- invoices

export async function listAllInvoices(opts: { status?: string; q?: string; limit?: number }) {
  let q = db
    .selectFrom('invoices')
    .innerJoin('organisations', 'organisations.id', 'invoices.org_id')
    .leftJoin('cohorts', 'cohorts.id', 'invoices.cohort_id')
    .select([
      'invoices.id',
      'invoices.invoice_number',
      'invoices.org_id',
      'invoices.kind',
      'invoices.tier_id',
      'invoices.total_ngn',
      'invoices.discount_ngn',
      'invoices.line_items',
      'invoices.status',
      'invoices.due_date',
      'invoices.paid_at',
      'invoices.notes',
      'invoices.created_at',
      'organisations.name as org_name',
      'organisations.contact_email',
      'cohorts.name as cohort_name',
      sql<number>`greatest(0, extract(day from now() - invoices.due_date))::int`.as('days_past_due'),
    ])
    .where('invoices.deleted_at', 'is', null);
  if (opts.status === 'unpaid') q = q.where('invoices.status', 'in', ['pending', 'overdue']);
  else if (opts.status) q = q.where('invoices.status', '=', opts.status);
  if (opts.q) {
    const like = `%${opts.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    q = q.where((eb) => eb.or([eb('invoices.invoice_number', 'ilike', like), eb('organisations.name', 'ilike', like)]));
  }
  return q.orderBy('invoices.created_at', 'desc').limit(Math.min(opts.limit ?? 200, 500)).execute();
}

async function loadOpenInvoice(invoiceId: string) {
  const invoice = await db.selectFrom('invoices').selectAll().where('id', '=', invoiceId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!invoice) throw notFound('Invoice not found');
  return invoice;
}

// Anyone still sitting on a checkout for the old amount must start again.
async function abandonOpenCheckouts(invoiceId: string, reason: string) {
  await db
    .updateTable('payments')
    .set({ status: 'abandoned', failure_reason: reason })
    .where('invoice_id', '=', invoiceId)
    .where('status', '=', 'pending')
    .execute();
}

async function orgAdminEmails(orgId: string) {
  const rows = await db
    .selectFrom('org_memberships')
    .innerJoin('people', 'people.id', 'org_memberships.person_id')
    .select('people.email')
    .where('org_memberships.org_id', '=', orgId)
    .where('org_memberships.role', '=', 'admin')
    .where('org_memberships.deleted_at', 'is', null)
    .where('people.deleted_at', 'is', null)
    .execute();
  const org = await db.selectFrom('organisations').select('contact_email').where('id', '=', orgId).executeTakeFirst();
  return [...new Set([...rows.map((r) => r.email), org?.contact_email].filter((e): e is string => !!e).map((e) => e.toLowerCase()))];
}

// Take an amount off an unpaid invoice (goodwill, pricing error, agreed deal).
export async function discountInvoice(actorPersonId: string, invoiceId: string, amount: number, reason: string) {
  const invoice = await loadOpenInvoice(invoiceId);
  if (invoice.status !== 'pending' && invoice.status !== 'overdue') throw badRequest(`Only unpaid invoices can be discounted (this one is ${invoice.status}).`);
  const total = Number(invoice.total_ngn);
  if (!(amount > 0) || amount > total) throw badRequest(`The discount must be more than ₦0 and at most the invoice total (${naira(total)}).`);

  const lines = [...((invoice.line_items as unknown[]) ?? []), { category: 'discount', description: `Discount: ${reason}`, quantity: 1, unit_ngn: -amount, amount_ngn: -amount }];
  const newTotal = Math.round((total - amount) * 100) / 100;
  const updated = await db
    .updateTable('invoices')
    .set({
      total_ngn: String(newTotal),
      discount_ngn: sql`discount_ngn + ${amount}`,
      line_items: JSON.stringify(lines),
      ...(newTotal === 0 ? { status: 'paid', paid_at: sql`now()`, notes: 'Settled by discount' } : {}),
    })
    .where('id', '=', invoiceId)
    .where('status', 'in', ['pending', 'overdue'])
    .returningAll()
    .executeTakeFirst();
  if (!updated) throw conflict('The invoice changed while you were editing it — reload and try again.');
  await abandonOpenCheckouts(invoiceId, 'Invoice amount changed');
  await writeAuditLog({ actorPersonId, actorContext: 'platform_admin', orgId: invoice.org_id, action: 'invoice_discounted', details: { invoice_id: invoiceId, invoice_number: invoice.invoice_number, amount, reason, new_total: newTotal } });
  return updated;
}

// Account credit: used automatically against the org's next invoices.
export async function adjustCredit(actorPersonId: string, orgId: string, amount: number, reason: string) {
  if (!Number.isFinite(amount) || amount === 0) throw badRequest('Enter a non-zero amount.');
  const org = await db.selectFrom('organisations').select(['id', 'credit_ngn']).where('id', '=', orgId).executeTakeFirst();
  if (!org) throw notFound('Organisation not found');
  if (Number(org.credit_ngn) + amount < 0) throw badRequest(`The org only has ${naira(Number(org.credit_ngn))} of credit to remove.`);
  const updated = await db
    .updateTable('organisations')
    .set({ credit_ngn: sql`credit_ngn + ${amount}` })
    .where('id', '=', orgId)
    .returning(['id', 'credit_ngn'])
    .executeTakeFirstOrThrow();
  await writeAuditLog({ actorPersonId, actorContext: 'platform_admin', orgId, action: amount > 0 ? 'credit_granted' : 'credit_removed', details: { amount, reason, balance: Number(updated.credit_ngn) } });
  return { credit_ngn: Number(updated.credit_ngn) };
}

export async function remindInvoice(actorPersonId: string, invoiceId: string) {
  const invoice = await loadOpenInvoice(invoiceId);
  if (invoice.status !== 'pending' && invoice.status !== 'overdue') throw badRequest(`This invoice is ${invoice.status} — nothing to chase.`);
  if (!emailConfigured()) throw badRequest('Email is not configured (RESEND_API_KEY), so no reminder can be sent.');
  const org = await db.selectFrom('organisations').select(['name']).where('id', '=', invoice.org_id).executeTakeFirstOrThrow();
  const to = await orgAdminEmails(invoice.org_id);
  if (!to.length) throw badRequest('This organisation has no admin email to send to.');

  const due = new Date(invoice.due_date as unknown as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const amount = naira(Number(invoice.total_ngn));
  const url = `${env.adminDashboardOrigin}/billing`;
  const overdue = invoice.status === 'overdue';
  const subject = `${overdue ? 'Overdue' : 'Reminder'}: Daprova invoice ${invoice.invoice_number} (${amount})`;
  const text = `Hello,\n\nInvoice ${invoice.invoice_number} for ${org.name} (${amount}) ${overdue ? 'was' : 'is'} due on ${due}.${overdue ? ` Once an invoice is ${BLOCK_AFTER_OVERDUE_DAYS} days overdue, new cohorts and new funder reports are paused until it's paid.` : ''}\n\nYou can pay it here: ${url}\n\nIf you've already paid, please reply to this email so we can match it.\n\nDaprova`;
  const html = text
    .split('\n\n')
    .map((p) => `<p>${escapeHtml(p).replace(escapeHtml(url), `<a href="${url}">${escapeHtml(url)}</a>`).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const results = await sendEmails(to.map((email) => ({ to: email, subject, html, text })));
  const sent = results.filter((r) => r.ok).length;
  const failed = results.find((r) => !r.ok);
  await writeAuditLog({ actorPersonId, actorContext: 'platform_admin', orgId: invoice.org_id, action: sent ? 'invoice_reminder_sent' : 'invoice_reminder_failed', details: { invoice_id: invoiceId, invoice_number: invoice.invoice_number, sent, to, ...(failed && !failed.ok ? { error: failed.error } : {}) } });
  if (!sent && failed && !failed.ok) throw badRequest(`The reminder could not be sent: ${failed.error}`);
  return { sent, to };
}

// ---------------------------------------------------------------- platform staff

export async function listPlatformAdmins() {
  return db
    .selectFrom('platform_admins')
    .innerJoin('people', 'people.id', 'platform_admins.person_id')
    .leftJoin('people as granter', 'granter.id', 'platform_admins.granted_by')
    .select([
      'platform_admins.id',
      'platform_admins.person_id',
      'platform_admins.platform_role',
      'platform_admins.granted_at',
      'people.email',
      'people.display_name',
      'people.last_login_at',
      'granter.email as granted_by_email',
    ])
    .orderBy('platform_admins.granted_at')
    .execute();
}

// Adds a staff member. Someone new gets a Firebase login with a random
// password they never see, then Firebase emails them a link to set their
// own — nobody at Daprova types or sees their password.
export async function addPlatformAdmin(actorPersonId: string, opts: { email: string; role: 'support' | 'owner'; display_name?: string }) {
  const email = opts.email.trim().toLowerCase();
  let person = await db.selectFrom('people').select(['id', 'email']).where(sql`lower(email)`, '=', email).where('deleted_at', 'is', null).executeTakeFirst();
  let passwordEmailSent = false;
  if (!person) {
    const { uid } = await firebaseAuth.createUser({ email, password: `${crypto.randomUUID()}Aa1!` }).catch((err: Error) => {
      if (err.message === 'EMAIL_EXISTS') throw conflict('That email already has a Firebase login but no Daprova account — contact engineering to link it.');
      throw err;
    });
    person = await db
      .insertInto('people')
      .values({ email, display_name: opts.display_name ?? null, auth_provider: 'firebase', auth_uid: uid })
      .returning(['id', 'email'])
      .executeTakeFirstOrThrow();
    await firebaseAuth.sendPasswordResetEmail(email);
    passwordEmailSent = true;
  }
  const existing = await db.selectFrom('platform_admins').select('id').where('person_id', '=', person.id).executeTakeFirst();
  if (existing) throw conflict('That person is already on the platform team.');
  await db.insertInto('platform_admins').values({ person_id: person.id, platform_role: opts.role, granted_by: actorPersonId }).execute();
  await writeAuditLog({ actorPersonId, actorContext: 'platform_admin', action: 'platform_admin_added', details: { email, role: opts.role, new_login: passwordEmailSent } });
  return { email, role: opts.role, password_email_sent: passwordEmailSent };
}

async function assertKeepsAnOwner(adminId: string) {
  const owners = await db.selectFrom('platform_admins').select('id').where('platform_role', '=', 'owner').execute();
  if (owners.length === 1 && owners[0].id === adminId) throw badRequest('This is the only owner — make someone else an owner first.');
}

export async function changePlatformRole(actorPersonId: string, adminId: string, role: 'support' | 'owner') {
  const admin = await db.selectFrom('platform_admins').selectAll().where('id', '=', adminId).executeTakeFirst();
  if (!admin) throw notFound('Staff member not found');
  if (role !== 'owner') await assertKeepsAnOwner(adminId);
  await db.updateTable('platform_admins').set({ platform_role: role }).where('id', '=', adminId).execute();
  await writeAuditLog({ actorPersonId, actorContext: 'platform_admin', action: 'platform_role_changed', details: { person_id: admin.person_id, from: admin.platform_role, to: role } });
}

export async function removePlatformAdmin(actorPersonId: string, adminId: string) {
  const admin = await db.selectFrom('platform_admins').selectAll().where('id', '=', adminId).executeTakeFirst();
  if (!admin) throw notFound('Staff member not found');
  if (admin.person_id === actorPersonId) throw badRequest("You can't remove yourself — ask another owner.");
  await assertKeepsAnOwner(adminId);
  await db.deleteFrom('platform_admins').where('id', '=', adminId).execute();
  await writeAuditLog({ actorPersonId, actorContext: 'platform_admin', action: 'platform_admin_removed', details: { person_id: admin.person_id, role: admin.platform_role } });
}

// ---------------------------------------------------------------- activity log

export async function activityLog(opts: { org_id?: string; action?: string; actor?: string; before?: string; limit?: number }) {
  let q = db
    .selectFrom('audit_log')
    .leftJoin('people', 'people.id', 'audit_log.actor_person_id')
    .leftJoin('organisations', 'organisations.id', 'audit_log.org_id')
    .select([
      'audit_log.id',
      'audit_log.created_at',
      'audit_log.action',
      'audit_log.actor_context',
      'audit_log.details',
      'audit_log.org_id',
      'people.email as actor_email',
      'organisations.name as org_name',
    ]);
  if (opts.org_id) q = q.where('audit_log.org_id', '=', opts.org_id);
  if (opts.action) q = q.where('audit_log.action', 'ilike', `%${opts.action.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  if (opts.actor) q = q.where('people.email', 'ilike', `%${opts.actor.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  if (opts.before) q = q.where(sql<boolean>`audit_log.created_at < ${new Date(opts.before)}`);
  const limit = Math.min(opts.limit ?? 100, 500);
  const rows = await q.orderBy('audit_log.created_at', 'desc').limit(limit).execute();
  return { entries: rows, next_before: rows.length === limit ? rows[rows.length - 1].created_at : null };
}

// ---------------------------------------------------------------- account fixes

export async function updateOrgProfile(actorPersonId: string, orgId: string, opts: { name?: string; contact_email?: string }) {
  const org = await db.selectFrom('organisations').select(['name', 'contact_email']).where('id', '=', orgId).executeTakeFirst();
  if (!org) throw notFound('Organisation not found');
  const updated = await db
    .updateTable('organisations')
    .set({ ...opts, updated_at: sql`now()` })
    .where('id', '=', orgId)
    .returning(['id', 'name', 'contact_email'])
    .executeTakeFirstOrThrow();
  await writeAuditLog({ actorPersonId, actorContext: 'platform_admin', orgId, action: 'org_profile_updated', details: { before: org, after: opts } });
  return updated;
}

async function assertMembership(orgId: string, membershipId: string) {
  const m = await db
    .selectFrom('org_memberships')
    .innerJoin('people', 'people.id', 'org_memberships.person_id')
    .select(['org_memberships.id', 'org_memberships.role', 'org_memberships.person_id', 'people.email'])
    .where('org_memberships.id', '=', membershipId)
    .where('org_memberships.org_id', '=', orgId)
    .where('org_memberships.deleted_at', 'is', null)
    .executeTakeFirst();
  if (!m) throw notFound('Member not found');
  return m;
}

async function adminCount(orgId: string) {
  const r = await db
    .selectFrom('org_memberships')
    .select(sql<string>`count(*)`.as('n'))
    .where('org_id', '=', orgId)
    .where('role', '=', 'admin')
    .where('deleted_at', 'is', null)
    .executeTakeFirstOrThrow();
  return Number(r.n);
}

export async function setMemberRole(actorPersonId: string, orgId: string, membershipId: string, role: 'admin' | 'viewer') {
  const m = await assertMembership(orgId, membershipId);
  if (m.role === 'admin' && role !== 'admin' && (await adminCount(orgId)) <= 1) throw badRequest('This is the organisation’s only admin — make someone else an admin first.');
  await db.updateTable('org_memberships').set({ role }).where('id', '=', membershipId).execute();
  await writeAuditLog({ actorPersonId, actorContext: 'platform_admin', orgId, action: 'member_role_changed_by_platform', details: { email: m.email, from: m.role, to: role } });
}

export async function removeOrgMember(actorPersonId: string, orgId: string, membershipId: string) {
  const m = await assertMembership(orgId, membershipId);
  if (m.role === 'admin' && (await adminCount(orgId)) <= 1) throw badRequest('This is the organisation’s only admin — make someone else an admin first.');
  await db.updateTable('org_memberships').set({ deleted_at: sql`now()` }).where('id', '=', membershipId).execute();
  await writeAuditLog({ actorPersonId, actorContext: 'platform_admin', orgId, action: 'member_removed_by_platform', details: { email: m.email, role: m.role } });
}

export async function sendMemberPasswordReset(actorPersonId: string, orgId: string, membershipId: string) {
  const m = await assertMembership(orgId, membershipId);
  await firebaseAuth.sendPasswordResetEmail(m.email);
  await writeAuditLog({ actorPersonId, actorContext: 'platform_admin', orgId, action: 'password_reset_sent', details: { email: m.email } });
  return { email: m.email };
}

export async function listOrgInvites(orgId: string) {
  return db
    .selectFrom('invites')
    .select(['id', 'email', 'role', 'expires_at', 'created_at'])
    .where('org_id', '=', orgId)
    .where('accepted_at', 'is', null)
    .orderBy('created_at', 'desc')
    .execute();
}

export async function inviteToOrg(actorPersonId: string, orgId: string, opts: { email: string; role: 'admin' | 'viewer' }) {
  const org = await db.selectFrom('organisations').select(['name']).where('id', '=', orgId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!org) throw notFound('Organisation not found');
  const actor = await db.selectFrom('people').select('email').where('id', '=', actorPersonId).executeTakeFirstOrThrow();
  await inviteMember(orgId, actorPersonId, org.name, `${actor.email} (Daprova)`, { email: opts.email.trim().toLowerCase(), role: opts.role }, `${env.adminDashboardOrigin}/accept-invite`);
  await writeAuditLog({ actorPersonId, actorContext: 'platform_admin', orgId, action: 'invite_sent_by_platform', details: opts });
}

// A fresh link and expiry; the old link stops working.
export async function resendInvite(actorPersonId: string, orgId: string, inviteId: string) {
  const invite = await db.selectFrom('invites').selectAll().where('id', '=', inviteId).where('org_id', '=', orgId).where('accepted_at', 'is', null).executeTakeFirst();
  if (!invite) throw notFound('Invite not found');
  // New link first: if the email fails, the old invite is still there.
  await inviteToOrg(actorPersonId, orgId, { email: invite.email, role: invite.role as 'admin' | 'viewer' });
  await db.deleteFrom('invites').where('id', '=', inviteId).execute();
}

export async function revokeInvite(actorPersonId: string, orgId: string, inviteId: string) {
  const invite = await db.deleteFrom('invites').where('id', '=', inviteId).where('org_id', '=', orgId).where('accepted_at', 'is', null).returning(['email']).executeTakeFirst();
  if (!invite) throw notFound('Invite not found');
  await writeAuditLog({ actorPersonId, actorContext: 'platform_admin', orgId, action: 'invite_revoked', details: { email: invite.email } });
}

export async function reopenOrg(actorPersonId: string, orgId: string, reason: string) {
  const org = await db.selectFrom('organisations').select(['deleted_at', 'verification_status']).where('id', '=', orgId).executeTakeFirst();
  if (!org) throw notFound('Organisation not found');
  if (!org.deleted_at) throw badRequest('This organisation is not closed.');
  if (org.verification_status === 'banned') throw badRequest('A banned organisation cannot be reopened.');
  await db.updateTable('organisations').set({ deleted_at: null }).where('id', '=', orgId).execute();
  await writeAuditLog({ actorPersonId, actorContext: 'platform_admin', orgId, action: 'org_reopened', details: { reason } });
}

// ---------------------------------------------------------------- announcements

type Audience = { audience: 'all' | 'tier' | 'org'; audience_tier?: string | null; audience_org_id?: string | null };

export async function listAnnouncements() {
  return db
    .selectFrom('announcements')
    .leftJoin('organisations', 'organisations.id', 'announcements.audience_org_id')
    .leftJoin('people', 'people.id', 'announcements.created_by')
    .select([
      'announcements.id',
      'announcements.title',
      'announcements.body',
      'announcements.level',
      'announcements.audience',
      'announcements.audience_tier',
      'announcements.audience_org_id',
      'announcements.starts_at',
      'announcements.ends_at',
      'announcements.emailed_count',
      'announcements.created_at',
      'organisations.name as audience_org_name',
      'people.email as created_by_email',
      sql<boolean>`announcements.starts_at <= now() and (announcements.ends_at is null or announcements.ends_at > now())`.as('is_live'),
    ])
    .where('announcements.deleted_at', 'is', null)
    .orderBy('announcements.created_at', 'desc')
    .limit(100)
    .execute();
}

async function audienceOrgIds(a: Audience) {
  let q = db.selectFrom('organisations').select('id').where('deleted_at', 'is', null);
  if (a.audience === 'tier') q = q.where('pricing_tier', '=', a.audience_tier!);
  if (a.audience === 'org') q = q.where('id', '=', a.audience_org_id!);
  return (await q.execute()).map((r) => r.id);
}

export async function createAnnouncement(
  actorPersonId: string,
  opts: Audience & { title: string; body: string; level: 'info' | 'warning'; starts_at?: string | null; ends_at?: string | null; send_email?: boolean },
) {
  if (opts.audience === 'tier' && !opts.audience_tier) throw badRequest('Choose which plan should see this.');
  if (opts.audience === 'org' && !opts.audience_org_id) throw badRequest('Choose which organisation should see this.');
  if (opts.ends_at && opts.starts_at && new Date(opts.ends_at) <= new Date(opts.starts_at)) throw badRequest('The end must be after the start.');
  if (opts.send_email && !emailConfigured()) throw badRequest('Email is not configured (RESEND_API_KEY) — untick "also email" or set it up first.');

  const created = await db
    .insertInto('announcements')
    .values({
      title: opts.title,
      body: opts.body,
      level: opts.level,
      audience: opts.audience,
      audience_tier: opts.audience === 'tier' ? opts.audience_tier! : null,
      audience_org_id: opts.audience === 'org' ? opts.audience_org_id! : null,
      ...(opts.starts_at ? { starts_at: new Date(opts.starts_at) } : {}),
      ends_at: opts.ends_at ? new Date(opts.ends_at) : null,
      created_by: actorPersonId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  let emailed = 0;
  if (opts.send_email) {
    const orgIds = await audienceOrgIds(opts);
    const recipients = new Set<string>();
    for (const id of orgIds) for (const e of await orgAdminEmails(id)) recipients.add(e);
    const text = `${opts.body}\n\n— The Daprova team\n${env.adminDashboardOrigin}`;
    const html = `${opts.body
      .split(/\n{2,}/)
      .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
      .join('')}<p>— The Daprova team<br><a href="${env.adminDashboardOrigin}">${escapeHtml(env.adminDashboardOrigin)}</a></p>`;
    const results = await sendEmails([...recipients].map((to) => ({ to, subject: opts.title, html, text })));
    emailed = results.filter((r) => r.ok).length;
    await db.updateTable('announcements').set({ emailed_count: emailed }).where('id', '=', created.id).execute();
  }
  await writeAuditLog({
    actorPersonId,
    actorContext: 'platform_admin',
    orgId: opts.audience === 'org' ? opts.audience_org_id : null,
    action: 'announcement_created',
    details: { id: created.id, title: opts.title, audience: opts.audience, audience_tier: opts.audience_tier ?? null, emailed },
  });
  return { ...created, emailed_count: emailed };
}

export async function endAnnouncement(actorPersonId: string, id: string) {
  const row = await db
    .updateTable('announcements')
    .set({ ends_at: sql`now()` })
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .returning(['id', 'title'])
    .executeTakeFirst();
  if (!row) throw notFound('Announcement not found');
  await writeAuditLog({ actorPersonId, actorContext: 'platform_admin', action: 'announcement_ended', details: row });
}

// What an organisation's users see in the app right now.
export async function activeAnnouncementsForOrg(orgId: string) {
  const org = await db.selectFrom('organisations').select('pricing_tier').where('id', '=', orgId).executeTakeFirst();
  if (!org) return [];
  return db
    .selectFrom('announcements')
    .select(['id', 'title', 'body', 'level', 'starts_at'])
    .where('deleted_at', 'is', null)
    .where(sql<boolean>`starts_at <= now()`)
    .where((eb) => eb.or([eb('ends_at', 'is', null), eb('ends_at', '>', sql<Date>`now()`)]))
    .where((eb) =>
      eb.or([
        eb('audience', '=', 'all'),
        eb.and([eb('audience', '=', 'tier'), eb('audience_tier', '=', org.pricing_tier)]),
        eb.and([eb('audience', '=', 'org'), eb('audience_org_id', '=', orgId)]),
      ]),
    )
    .orderBy('starts_at', 'desc')
    .limit(5)
    .execute();
}
