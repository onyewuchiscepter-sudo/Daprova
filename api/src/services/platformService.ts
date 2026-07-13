import { db } from '../db/index.js';
import { firebaseAuth } from '../lib/firebaseAdmin.js';
import { conflict, notFound } from '../lib/errors.js';
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
