import crypto from 'node:crypto';
import { sql } from 'kysely';
import { db } from '../db/index.js';
import { firebaseAuth } from '../lib/firebaseAdmin.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { writeAuditLog } from '../lib/auditLog.js';
import { billingSummary, listInvoices, markInvoicePaid, runBillingCycle } from './billing/index.js';

// Every org with the figures the console filters and sorts by.
export async function listOrgs() {
  return db
    .selectFrom('organisations as o')
    .select([
      'o.id',
      'o.name',
      'o.slug',
      'o.contact_email',
      'o.billing_status',
      'o.verification_status',
      'o.pricing_tier',
      'o.billing_frequency',
      'o.is_enterprise_custom',
      'o.billing_started_at',
      'o.credit_ngn',
      'o.created_at',
      'o.deleted_at',
      sql<number>`(select count(*) from org_memberships m where m.org_id = o.id and m.deleted_at is null)::int`.as('member_count'),
      sql<number>`(select count(*) from cohorts c join courses cr on cr.id = c.course_id where cr.org_id = o.id and c.deleted_at is null)::int`.as('cohort_count'),
      sql<string>`(select coalesce(sum(i.total_ngn), 0) from invoices i where i.org_id = o.id and i.status in ('pending','overdue') and i.deleted_at is null)`.as('outstanding_ngn'),
      sql<boolean>`exists (select 1 from invoices i where i.org_id = o.id and i.status = 'overdue' and i.deleted_at is null)`.as('has_overdue'),
      sql<Date | null>`(select max(p.last_login_at) from org_memberships m join people p on p.id = m.person_id where m.org_id = o.id and m.deleted_at is null)`.as('last_login_at'),
    ])
    .orderBy('o.created_at', 'desc')
    .execute();
}

// docs/org-onboarding-spec.md §7.2 — "view any org's full profile, members,
// billing, cohorts." Billing fields are already on the org row itself
// (selectAll above); cohorts are added here so a platform admin can see
// what they'd actually be overriding before taking a tier-override action.
export async function getOrgDetail(orgId: string) {
  const org = await db.selectFrom('organisations').selectAll().where('id', '=', orgId).executeTakeFirst();
  if (!org) throw notFound('Organisation not found');

  const members = await db
    .selectFrom('org_memberships')
    .innerJoin('people', 'people.id', 'org_memberships.person_id')
    .select(['people.id', 'org_memberships.id as membership_id', 'people.email', 'people.display_name', 'people.title', 'people.phone', 'people.last_login_at', 'org_memberships.role', 'org_memberships.created_at'])
    .where('org_memberships.org_id', '=', orgId)
    .where('org_memberships.deleted_at', 'is', null)
    .execute();

  const cohorts = await db
    .selectFrom('cohorts')
    .innerJoin('courses', 'courses.id', 'cohorts.course_id')
    .select(['cohorts.id', 'cohorts.name', 'cohorts.status', 'cohorts.student_count', 'cohorts.is_free_trial', 'cohorts.finalized_at'])
    .where('courses.org_id', '=', orgId)
    .where('cohorts.deleted_at', 'is', null)
    .orderBy('cohorts.created_at', 'desc')
    .execute();

  const [billing, invoices, invites] = await Promise.all([
    billingSummary(orgId),
    listInvoices(orgId),
    db.selectFrom('invites').select(['id', 'email', 'role', 'expires_at', 'created_at']).where('org_id', '=', orgId).where('accepted_at', 'is', null).orderBy('created_at', 'desc').execute(),
  ]);
  return { ...org, logo_data: undefined, members, cohorts, billing: { ...billing, tiers: undefined }, invoices, invites };
}

// Model B (docs/org-onboarding-spec.md §1): a Daprova team member creates
// the org and its first admin directly, setting a real password — no
// invite email, no pending state. The team communicates the login to the
// customer outside the system.
export async function createOrgWithAdmin(
  platformAdminPersonId: string,
  opts: {
    org_name: string;
    org_slug: string;
    contact_email: string;
    admin_email: string;
    admin_display_name?: string;
    // Omitted: the admin gets an email from Firebase to choose their own.
    admin_password?: string;
  },
) {
  const existingSlug = await db.selectFrom('organisations').select('id').where('slug', '=', opts.org_slug).executeTakeFirst();
  if (existingSlug) throw conflict('An organisation with that slug already exists');

  const existingPerson = await db.selectFrom('people').select('id').where('email', '=', opts.admin_email).executeTakeFirst();
  if (existingPerson) throw conflict('A person with that email already exists');

  const fbUser = await firebaseAuth.createUser({ email: opts.admin_email, password: opts.admin_password ?? `${crypto.randomUUID()}Aa1!`, emailVerified: true }).catch((err) => {
    // Can legitimately happen even though the `people` check above passed —
    // e.g. a previous attempt created the Firebase account but failed
    // before its `people` row was written. Surface a clean conflict rather
    // than a raw Identity Toolkit error string leaking through as a 500.
    if (err instanceof Error && err.message === 'EMAIL_EXISTS') {
      throw conflict('A Firebase account with that email already exists');
    }
    throw err;
  });

  const org = await db
    .insertInto('organisations')
    // verification_status defaults to 'verified' at the column level, but
    // set explicitly here too — Model B org creation *is* the vetting
    // (a platform admin is doing this directly), so it should never be
    // ambiguous or accidentally affected if that default ever changes.
    .values({ name: opts.org_name, slug: opts.org_slug, contact_email: opts.contact_email, verification_status: 'verified' })
    .returningAll()
    .executeTakeFirstOrThrow();

  const person = await db
    .insertInto('people')
    .values({ email: opts.admin_email, display_name: opts.admin_display_name ?? null, auth_provider: 'firebase', auth_uid: fbUser.uid })
    .returningAll()
    .executeTakeFirstOrThrow();

  await db.insertInto('org_memberships').values({ person_id: person.id, org_id: org.id, role: 'admin' }).execute();

  await writeAuditLog({
    actorPersonId: platformAdminPersonId,
    actorContext: 'platform_admin',
    orgId: org.id,
    action: 'org_created_by_platform',
    details: { admin_email: opts.admin_email, password_email: !opts.admin_password },
  });
  if (!opts.admin_password) await firebaseAuth.sendPasswordResetEmail(opts.admin_email);

  return { org: { id: org.id, name: org.name, slug: org.slug }, admin: { id: person.id, email: person.email }, password_email_sent: !opts.admin_password };
}

// docs/org-onboarding-spec.md §7.2/§7.5 — the fraud-review queue. `support`
// role is sufficient (already enforced at the router level), since
// approving/rejecting a flagged signup doesn't itself change billing or
// suspend anything — that's a separate `owner`-only org-regulation action
// (Sprint 7) a reviewer would take as a manual follow-up if they reject.
export async function listFraudFlags() {
  return db
    .selectFrom('signup_fraud_flags')
    .innerJoin('organisations as new_org', 'new_org.id', 'signup_fraud_flags.org_id')
    .innerJoin('organisations as matched_org', 'matched_org.id', 'signup_fraud_flags.matched_org_id')
    .select([
      'signup_fraud_flags.id',
      'signup_fraud_flags.match_reason',
      'signup_fraud_flags.reviewed_at',
      'signup_fraud_flags.decision',
      'signup_fraud_flags.created_at',
      'new_org.id as org_id',
      'new_org.name as org_name',
      'matched_org.id as matched_org_id',
      'matched_org.name as matched_org_name',
    ])
    .orderBy('signup_fraud_flags.created_at', 'desc')
    .execute();
}

export async function reviewFraudFlag(reviewerPersonId: string, flagId: string, decision: 'approved' | 'rejected') {
  const flag = await db.selectFrom('signup_fraud_flags').selectAll().where('id', '=', flagId).executeTakeFirst();
  if (!flag) throw notFound('Fraud flag not found');
  if (flag.reviewed_at) throw badRequest('This flag has already been reviewed');

  const updated = await db
    .updateTable('signup_fraud_flags')
    .set({ reviewed_at: sql`now()`, reviewed_by: reviewerPersonId, decision })
    .where('id', '=', flagId)
    .returningAll()
    .executeTakeFirstOrThrow();

  // Only clear the org's flagged status once every one of its flags has
  // been reviewed — a single org can accumulate more than one match row.
  const stillPending = await db
    .selectFrom('signup_fraud_flags')
    .select('id')
    .where('org_id', '=', flag.org_id)
    .where('reviewed_at', 'is', null)
    .executeTakeFirst();
  if (!stillPending) {
    await db.updateTable('organisations').set({ signup_review_status: null }).where('id', '=', flag.org_id).execute();
  }

  await writeAuditLog({
    actorPersonId: reviewerPersonId,
    actorContext: 'platform_admin',
    orgId: flag.org_id,
    action: 'fraud_flag_reviewed',
    details: { flag_id: flagId, matched_org_id: flag.matched_org_id, match_reason: flag.match_reason, decision },
  });

  return updated;
}

async function assertOrgExists(orgId: string) {
  const org = await db.selectFrom('organisations').selectAll().where('id', '=', orgId).executeTakeFirst();
  if (!org) throw notFound('Organisation not found');
  return org;
}

// docs/org-onboarding-spec.md — the verification queue for self-serve
// (Model A) signups. Separate axis from the fraud-flags queue above and
// from billing_status entirely: every 'pending' org shows up here whether
// or not it also happens to be fraud-flagged, and clicking into one on the
// platform dashboard shows the full registration-detail block (org type,
// CAC number, website, address, use case, cadence, funder-reporting info,
// referral source, admin contact) captured at signup time.
export async function listPendingVerificationOrgs() {
  return db
    .selectFrom('organisations')
    .selectAll()
    .where('verification_status', '=', 'pending')
    .where('deleted_at', 'is', null)
    .orderBy('created_at', 'asc')
    .execute();
}

// `support` role is sufficient (router-level gate), same reasoning as
// reviewFraudFlag above — verifying a registration doesn't touch billing
// or suspend/ban anything, so it doesn't need the stricter owner-only bar.
export async function verifyOrg(actorPersonId: string, orgId: string) {
  const org = await assertOrgExists(orgId);
  if (org.verification_status !== 'pending') throw badRequest('Organisation is not awaiting verification');
  const updated = await db
    .updateTable('organisations')
    .set({ verification_status: 'verified' })
    .where('id', '=', orgId)
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeAuditLog({ actorPersonId, actorContext: 'platform_admin', orgId, action: 'org_verified', details: null });
  return updated;
}

// "Ban" (§ user's verification-flow request) is deliberately more severe
// and more permanent than suspend: it sets verification_status='banned'
// (distinct from 'pending'/'verified', so it can never silently pass the
// requireVerified gate again) *and* soft-deletes the org via the same
// deleted_at pattern closeOrg uses, since a banned registration shouldn't
// be recoverable by just flipping a status back like a suspension is.
// Owner-only, matching the existing suspend/close precedent.
export async function banOrg(actorPersonId: string, orgId: string, reason: string) {
  await assertOrgExists(orgId);
  const updated = await db
    .updateTable('organisations')
    .set({ verification_status: 'banned', deleted_at: sql`now()` })
    .where('id', '=', orgId)
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeAuditLog({ actorPersonId, actorContext: 'platform_admin', orgId, action: 'org_banned', details: { reason } });
  return updated;
}

// docs/org-onboarding-spec.md §7.2 — owner-only org-regulation actions.
// Suspension is enforced where every login-completing path already
// converges (lib/sessionIssuance.ts's issueSession), not re-implemented
// here — this function only flips the flag and logs it.
export async function suspendOrg(actorPersonId: string, orgId: string, reason: string) {
  await assertOrgExists(orgId);
  const org = await db
    .updateTable('organisations')
    .set({ billing_status: 'suspended' })
    .where('id', '=', orgId)
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeAuditLog({ actorPersonId, actorContext: 'platform_admin', orgId, action: 'org_suspended', details: { reason } });
  return org;
}

export async function reactivateOrg(actorPersonId: string, orgId: string, reason: string) {
  const org = await assertOrgExists(orgId);
  if (org.billing_status !== 'suspended') throw badRequest('Organisation is not currently suspended');
  const updated = await db
    .updateTable('organisations')
    .set({ billing_status: 'active' })
    .where('id', '=', orgId)
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeAuditLog({ actorPersonId, actorContext: 'platform_admin', orgId, action: 'org_reactivated', details: { reason } });
  return updated;
}

// Pricing spec §3/§6 — platform control of an org's plan: set its tier
// (e.g. an agreed early upgrade), billing frequency, projected volume, or an
// Enterprise deal (is_enterprise_custom + custom_pricing_json overrides).
// Nothing already invoiced changes.
export async function setOrgPricing(
  actorPersonId: string,
  orgId: string,
  opts: {
    pricing_tier?: 'starter' | 'growth' | 'scale' | 'enterprise';
    billing_frequency?: 'monthly' | 'per_cohort_cycle';
    projected_students_per_year?: number | null;
    is_enterprise_custom?: boolean;
    custom_pricing_json?: Record<string, unknown> | null;
    reason: string;
  },
) {
  const org = await assertOrgExists(orgId);
  const patch: Record<string, unknown> = {};
  if (opts.pricing_tier && opts.pricing_tier !== org.pricing_tier) {
    patch.pricing_tier = opts.pricing_tier;
    patch.tier_effective_date = sql`now()`;
    patch.pending_tier = null;
  }
  if (opts.billing_frequency) patch.billing_frequency = opts.billing_frequency;
  if (opts.projected_students_per_year !== undefined) patch.projected_students_per_year = opts.projected_students_per_year;
  if (opts.is_enterprise_custom !== undefined) patch.is_enterprise_custom = opts.is_enterprise_custom;
  if (opts.custom_pricing_json !== undefined) patch.custom_pricing_json = opts.custom_pricing_json === null ? null : JSON.stringify(opts.custom_pricing_json);
  // A negotiated Enterprise deal lifts the "contact sales" hold.
  if (opts.is_enterprise_custom && org.billing_status === 'pending_manual_quote') patch.billing_status = 'active';
  if (!Object.keys(patch).length) return org;

  const updated = await db.updateTable('organisations').set(patch).where('id', '=', orgId).returningAll().executeTakeFirstOrThrow();
  await writeAuditLog({
    actorPersonId,
    actorContext: 'platform_admin',
    orgId,
    action: 'pricing_updated',
    details: { before: { pricing_tier: org.pricing_tier, billing_frequency: org.billing_frequency, is_enterprise_custom: org.is_enterprise_custom }, changes: opts },
  });
  return updated;
}

// Offline payment (bank transfer) or a goodwill write-off of an invoice.
export async function settleInvoice(actorPersonId: string, invoiceId: string, action: 'mark_paid' | 'void', note: string) {
  const invoice = await db.selectFrom('invoices').selectAll().where('id', '=', invoiceId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!invoice) throw notFound('Invoice not found');
  let updated;
  // Anyone mid-checkout on this invoice must not be charged for it now.
  await db
    .updateTable('payments')
    .set({ status: 'abandoned', failure_reason: action === 'void' ? 'Invoice voided' : 'Invoice settled offline' })
    .where('invoice_id', '=', invoiceId)
    .where('status', '=', 'pending')
    .execute();
  if (action === 'mark_paid') {
    updated = await markInvoicePaid(invoiceId, note);
    if (!updated) throw badRequest(`Invoice is ${invoice.status}, not awaiting payment`);
  } else {
    if (invoice.status === 'paid') throw badRequest('A paid invoice cannot be voided');
    updated = await db.updateTable('invoices').set({ status: 'void', notes: note }).where('id', '=', invoiceId).returningAll().executeTakeFirstOrThrow();
  }
  await writeAuditLog({ actorPersonId, actorContext: 'platform_admin', orgId: invoice.org_id, action: action === 'void' ? 'invoice_voided' : 'invoice_marked_paid', details: { invoice_id: invoiceId, invoice_number: invoice.invoice_number, note } });
  return updated;
}

export async function runBillingNow() {
  return runBillingCycle();
}

const VALID_BILLING_STATUSES = ['active', 'pending_manual_quote', 'suspended'] as const;

// "Manually correct billing status" (§7.2) — e.g. confirming an offline
// bank-transfer payment for an Enterprise deal by moving it out of
// pending_manual_quote without going through the (self-serve-only) payment
// flow. Deliberately separate from suspend/reactivate above, which cover
// the one status transition platform staff take most often and are worth
// naming explicitly in the audit log rather than folding into this generic action.
export async function correctBillingStatus(actorPersonId: string, orgId: string, newStatus: string, reason: string) {
  if (!VALID_BILLING_STATUSES.includes(newStatus as (typeof VALID_BILLING_STATUSES)[number])) {
    throw badRequest(`Invalid billing status: ${newStatus}`);
  }
  const org = await assertOrgExists(orgId);
  const updated = await db
    .updateTable('organisations')
    .set({ billing_status: newStatus })
    .where('id', '=', orgId)
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeAuditLog({
    actorPersonId,
    actorContext: 'platform_admin',
    orgId,
    action: 'billing_status_corrected',
    details: { old_status: org.billing_status, new_status: newStatus, reason },
  });
  return updated;
}

// "Extend or grant a free-trial exception" (§7.2) — goodwill: the org's
// next cohort is free (assessment fees waived for up to 50 learners).
export async function extendFreeTrial(actorPersonId: string, orgId: string, reason: string) {
  await assertOrgExists(orgId);
  const updated = await db
    .updateTable('organisations')
    .set((eb) => ({ free_cohorts_remaining: eb('free_cohorts_remaining', '+', 1) }))
    .where('id', '=', orgId)
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeAuditLog({ actorPersonId, actorContext: 'platform_admin', orgId, action: 'free_trial_extended', details: { reason } });
  return updated;
}

// "Close/delete an org" (§7.2) — soft delete, same pattern used throughout
// the schema. Historical data (cohorts, learners, reports) is untouched;
// only the org itself and its memberships stop being usable for login
// (issueSession already rejects a deleted org, same as a suspended one).
export async function closeOrg(actorPersonId: string, orgId: string, reason: string) {
  await assertOrgExists(orgId);
  const updated = await db
    .updateTable('organisations')
    .set({ deleted_at: sql`now()` })
    .where('id', '=', orgId)
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeAuditLog({ actorPersonId, actorContext: 'platform_admin', orgId, action: 'org_closed', details: { reason } });
  return updated;
}
