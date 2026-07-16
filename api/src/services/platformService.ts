import { sql } from 'kysely';
import { db } from '../db/index.js';
import { firebaseAuth } from '../lib/firebaseAdmin.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { writeAuditLog } from '../lib/auditLog.js';
import { getTier } from './pricingService.js';

export async function listOrgs() {
  return db
    .selectFrom('organisations')
    .select(['id', 'name', 'slug', 'contact_email', 'billing_status', 'verification_status', 'created_at', 'deleted_at'])
    .orderBy('created_at', 'desc')
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
    .select(['people.id', 'people.email', 'people.display_name', 'people.title', 'people.phone', 'org_memberships.role', 'org_memberships.created_at'])
    .where('org_memberships.org_id', '=', orgId)
    .where('org_memberships.deleted_at', 'is', null)
    .execute();

  const cohorts = await db
    .selectFrom('cohorts')
    .innerJoin('courses', 'courses.id', 'cohorts.course_id')
    .select(['cohorts.id', 'cohorts.name', 'cohorts.status', 'cohorts.student_count', 'cohorts.plan_tier_at_creation', 'cohorts.is_free_trial'])
    .where('courses.org_id', '=', orgId)
    .where('cohorts.deleted_at', 'is', null)
    .orderBy('cohorts.created_at', 'desc')
    .execute();

  return { ...org, members, cohorts };
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
    admin_password: string;
  },
) {
  const existingSlug = await db.selectFrom('organisations').select('id').where('slug', '=', opts.org_slug).executeTakeFirst();
  if (existingSlug) throw conflict('An organisation with that slug already exists');

  const existingPerson = await db.selectFrom('people').select('id').where('email', '=', opts.admin_email).executeTakeFirst();
  if (existingPerson) throw conflict('A person with that email already exists');

  const fbUser = await firebaseAuth.createUser({ email: opts.admin_email, password: opts.admin_password, emailVerified: true }).catch((err) => {
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
    details: { admin_email: opts.admin_email },
  });

  return { org: { id: org.id, name: org.name, slug: org.slug }, admin: { id: person.id, email: person.email } };
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
export async function banOrg(actorPersonId: string, orgId: string) {
  await assertOrgExists(orgId);
  const updated = await db
    .updateTable('organisations')
    .set({ verification_status: 'banned', deleted_at: sql`now()` })
    .where('id', '=', orgId)
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeAuditLog({ actorPersonId, actorContext: 'platform_admin', orgId, action: 'org_banned', details: null });
  return updated;
}

// docs/org-onboarding-spec.md §7.2 — owner-only org-regulation actions.
// Suspension is enforced where every login-completing path already
// converges (lib/sessionIssuance.ts's issueSession), not re-implemented
// here — this function only flips the flag and logs it.
export async function suspendOrg(actorPersonId: string, orgId: string) {
  await assertOrgExists(orgId);
  const org = await db
    .updateTable('organisations')
    .set({ billing_status: 'suspended' })
    .where('id', '=', orgId)
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeAuditLog({ actorPersonId, actorContext: 'platform_admin', orgId, action: 'org_suspended', details: null });
  return org;
}

export async function reactivateOrg(actorPersonId: string, orgId: string) {
  const org = await assertOrgExists(orgId);
  if (org.billing_status !== 'suspended') throw badRequest('Organisation is not currently suspended');
  const updated = await db
    .updateTable('organisations')
    .set({ billing_status: 'active' })
    .where('id', '=', orgId)
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeAuditLog({ actorPersonId, actorContext: 'platform_admin', orgId, action: 'org_reactivated', details: null });
  return updated;
}

// "Override an org's plan tier" (§7.2) is implemented as overriding a
// specific cohort's tier — pricing is per-cohort (§5.7, Sprint 4), so an
// org-wide field wouldn't actually change what checkCapacity/hasFeature
// enforce. Bypasses the normal upgrade-path/payment flow entirely, as the
// spec describes ("manual correction or comping a customer").
export async function overrideCohortTier(actorPersonId: string, orgId: string, cohortId: string, newTierId: string) {
  const cohort = await db
    .selectFrom('cohorts')
    .innerJoin('courses', 'courses.id', 'cohorts.course_id')
    .selectAll('cohorts')
    .where('cohorts.id', '=', cohortId)
    .where('courses.org_id', '=', orgId)
    .executeTakeFirst();
  if (!cohort) throw notFound('Cohort not found in this organisation');

  const tier = await getTier(newTierId);

  const updated = await db
    .updateTable('cohorts')
    .set({ plan_tier_at_creation: tier.tier_id, status: cohort.status === 'locked_pending_upgrade' ? 'active' : cohort.status })
    .where('id', '=', cohortId)
    .returningAll()
    .executeTakeFirstOrThrow();
  await db
    .insertInto('cohort_tier_history')
    .values({ cohort_id: cohortId, old_tier: cohort.plan_tier_at_creation, new_tier: tier.tier_id, payment_id: null })
    .execute();

  await writeAuditLog({
    actorPersonId,
    actorContext: 'platform_admin',
    orgId,
    action: 'tier_overridden',
    details: { cohort_id: cohortId, old_tier: cohort.plan_tier_at_creation, new_tier: tier.tier_id },
  });

  return updated;
}

const VALID_BILLING_STATUSES = ['active', 'locked_pending_upgrade', 'pending_manual_quote', 'suspended'] as const;

// "Manually correct billing status" (§7.2) — e.g. confirming an offline
// bank-transfer payment for an Enterprise deal by moving it out of
// pending_manual_quote without going through the (self-serve-only) payment
// flow. Deliberately separate from suspend/reactivate above, which cover
// the one status transition platform staff take most often and are worth
// naming explicitly in the audit log rather than folding into this generic action.
export async function correctBillingStatus(actorPersonId: string, orgId: string, newStatus: string) {
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
    details: { old_status: org.billing_status, new_status: newStatus },
  });
  return updated;
}

// "Extend or grant a free-trial exception" (§7.2) — goodwill override of
// §5.4's one-time rule. Resets the flag rather than directly assigning
// FREE_TRIAL to a cohort, so the existing assignTierForNewCohort logic
// naturally grants it again the next time this org creates a cohort —
// no special-casing needed anywhere else.
export async function extendFreeTrial(actorPersonId: string, orgId: string) {
  await assertOrgExists(orgId);
  const updated = await db
    .updateTable('organisations')
    .set({ has_used_free_trial: false })
    .where('id', '=', orgId)
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeAuditLog({ actorPersonId, actorContext: 'platform_admin', orgId, action: 'free_trial_extended', details: null });
  return updated;
}

// "Close/delete an org" (§7.2) — soft delete, same pattern used throughout
// the schema. Historical data (cohorts, learners, reports) is untouched;
// only the org itself and its memberships stop being usable for login
// (issueSession already rejects a deleted org, same as a suspended one).
export async function closeOrg(actorPersonId: string, orgId: string) {
  await assertOrgExists(orgId);
  const updated = await db
    .updateTable('organisations')
    .set({ deleted_at: sql`now()` })
    .where('id', '=', orgId)
    .returningAll()
    .executeTakeFirstOrThrow();
  await writeAuditLog({ actorPersonId, actorContext: 'platform_admin', orgId, action: 'org_closed', details: null });
  return updated;
}
