import crypto from 'node:crypto';
import { sql } from 'kysely';
import { db } from '../db/index.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { sendInviteEmail } from '../lib/email.js';
import { writeAuditLog } from '../lib/auditLog.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function listMembers(orgId: string) {
  return db
    .selectFrom('org_memberships')
    .innerJoin('people', 'people.id', 'org_memberships.person_id')
    .select(['org_memberships.id', 'people.email', 'people.display_name', 'org_memberships.role', 'org_memberships.created_at'])
    .where('org_memberships.org_id', '=', orgId)
    .where('org_memberships.deleted_at', 'is', null)
    .orderBy('org_memberships.created_at')
    .execute();
}

export async function listPendingInvites(orgId: string) {
  return db
    .selectFrom('invites')
    .select(['id', 'email', 'role', 'expires_at', 'created_at'])
    .where('org_id', '=', orgId)
    .where('accepted_at', 'is', null)
    .orderBy('created_at', 'desc')
    .execute();
}

export async function inviteMember(
  orgId: string,
  inviterPersonId: string,
  orgName: string,
  inviterEmail: string,
  opts: { email: string; role: 'admin' | 'viewer' },
  acceptUrlBase: string,
) {
  const existingMembership = await db
    .selectFrom('org_memberships')
    .innerJoin('people', 'people.id', 'org_memberships.person_id')
    .select('org_memberships.id')
    .where('org_memberships.org_id', '=', orgId)
    .where('people.email', '=', opts.email)
    .where('org_memberships.deleted_at', 'is', null)
    .executeTakeFirst();
  if (existingMembership) throw conflict('This person is already a member of this organisation');

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await db
    .insertInto('invites')
    .values({ org_id: orgId, email: opts.email, role: opts.role, token, invited_by: inviterPersonId, expires_at: expiresAt })
    .execute();

  await sendInviteEmail({ to: opts.email, orgName, inviterEmail, acceptUrl: `${acceptUrlBase}/${token}` });

  await writeAuditLog({
    actorPersonId: inviterPersonId,
    actorContext: 'org_admin',
    orgId,
    action: 'invite_created',
    details: { email: opts.email, role: opts.role },
  });
}

export async function getInvitePreview(token: string) {
  const invite = await db
    .selectFrom('invites')
    .innerJoin('organisations', 'organisations.id', 'invites.org_id')
    .select(['invites.email', 'invites.role', 'invites.expires_at', 'invites.accepted_at', 'organisations.name as org_name'])
    .where('invites.token', '=', token)
    .executeTakeFirst();
  if (!invite) throw notFound('Invite not found');
  if (invite.accepted_at) throw badRequest('Invite already accepted');
  if (new Date(invite.expires_at as unknown as string) < new Date()) throw badRequest('Invite has expired');
  return { org_name: invite.org_name, email: invite.email, role: invite.role };
}

// Accepting an invite links a Firebase-authenticated person to the org —
// the invite's own `email` field is the source of truth for which email is
// allowed to accept it, matched against the verified token holder's email.
// If the person already exists (e.g. accepting a second org's invite),
// reuse their existing `people` row rather than creating a duplicate.
export async function acceptInvite(token: string, authUid: string, email: string, displayName?: string) {
  const invite = await db.selectFrom('invites').selectAll().where('token', '=', token).executeTakeFirst();
  if (!invite) throw notFound('Invite not found');
  if (invite.accepted_at) throw badRequest('Invite already accepted');
  if (new Date(invite.expires_at as unknown as string) < new Date()) throw badRequest('Invite has expired');
  if (invite.email.toLowerCase() !== email.toLowerCase()) throw forbidden('This invite was issued to a different email address');

  let person = await db.selectFrom('people').selectAll().where('auth_uid', '=', authUid).executeTakeFirst();
  if (!person) person = await db.selectFrom('people').selectAll().where('email', '=', email).executeTakeFirst();
  if (!person) {
    person = await db
      .insertInto('people')
      .values({ email, display_name: displayName ?? null, auth_provider: 'firebase', auth_uid: authUid })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  const existingMembership = await db
    .selectFrom('org_memberships')
    .selectAll()
    .where('person_id', '=', person.id)
    .where('org_id', '=', invite.org_id)
    .executeTakeFirst();
  if (!existingMembership) {
    await db.insertInto('org_memberships').values({ person_id: person.id, org_id: invite.org_id, role: invite.role }).execute();
  }

  await db.updateTable('invites').set({ accepted_at: new Date() }).where('id', '=', invite.id).execute();

  await writeAuditLog({
    actorPersonId: person.id,
    actorContext: 'org_admin',
    orgId: invite.org_id,
    action: 'invite_accepted',
    details: { email },
  });

  return { org_id: invite.org_id, person_id: person.id };
}

// Last-admin protection (docs/org-onboarding-spec.md §9.2) — never leave an
// org with zero admins.
async function assertNotLastAdmin(orgId: string, membershipId: string) {
  const membership = await db.selectFrom('org_memberships').selectAll().where('id', '=', membershipId).where('org_id', '=', orgId).executeTakeFirst();
  if (!membership) throw notFound('Member not found');
  if (membership.role !== 'admin') return;

  const adminCount = await db
    .selectFrom('org_memberships')
    .select(({ fn }) => fn.countAll().as('count'))
    .where('org_id', '=', orgId)
    .where('role', '=', 'admin')
    .where('deleted_at', 'is', null)
    .executeTakeFirstOrThrow();
  if (Number(adminCount.count) <= 1) throw badRequest('Cannot remove the last admin of an organisation');
}

export async function changeRole(orgId: string, membershipId: string, newRole: 'admin' | 'viewer', actorPersonId: string) {
  if (newRole !== 'admin') await assertNotLastAdmin(orgId, membershipId);

  const membership = await db
    .updateTable('org_memberships')
    .set({ role: newRole })
    .where('id', '=', membershipId)
    .where('org_id', '=', orgId)
    .returningAll()
    .executeTakeFirst();
  if (!membership) throw notFound('Member not found');

  await writeAuditLog({
    actorPersonId,
    actorContext: 'org_admin',
    orgId,
    action: 'role_changed',
    details: { membership_id: membershipId, new_role: newRole },
  });
  return membership;
}

export async function removeMember(orgId: string, membershipId: string, actorPersonId: string) {
  await assertNotLastAdmin(orgId, membershipId);
  await db.updateTable('org_memberships').set({ deleted_at: new Date() }).where('id', '=', membershipId).where('org_id', '=', orgId).execute();

  await writeAuditLog({
    actorPersonId,
    actorContext: 'org_admin',
    orgId,
    action: 'member_removed',
    details: { membership_id: membershipId },
  });
}

export async function updateOrgProfile(orgId: string, opts: { name?: string; logo_url?: string; contact_email?: string }) {
  const org = await db
    .updateTable('organisations')
    .set({ ...opts, updated_at: sql`now()` })
    .where('id', '=', orgId)
    .returningAll()
    .executeTakeFirst();
  if (!org) throw notFound('Organisation not found');
  return org;
}
