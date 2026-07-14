import { sql } from 'kysely';
import { db } from '../db/index.js';
import { firebaseAuth } from '../lib/firebaseAdmin.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { writeAuditLog } from '../lib/auditLog.js';

export async function listOrgs() {
  return db
    .selectFrom('organisations')
    .select(['id', 'name', 'slug', 'contact_email', 'created_at', 'deleted_at'])
    .orderBy('created_at', 'desc')
    .execute();
}

export async function getOrgDetail(orgId: string) {
  const org = await db.selectFrom('organisations').selectAll().where('id', '=', orgId).executeTakeFirst();
  if (!org) throw notFound('Organisation not found');

  const members = await db
    .selectFrom('org_memberships')
    .innerJoin('people', 'people.id', 'org_memberships.person_id')
    .select(['people.id', 'people.email', 'people.display_name', 'org_memberships.role', 'org_memberships.created_at'])
    .where('org_memberships.org_id', '=', orgId)
    .where('org_memberships.deleted_at', 'is', null)
    .execute();

  return { ...org, members };
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
    .values({ name: opts.org_name, slug: opts.org_slug, contact_email: opts.contact_email })
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
