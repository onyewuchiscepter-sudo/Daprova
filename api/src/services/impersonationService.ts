import { sql } from 'kysely';
import { db } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { writeAuditLog } from '../lib/auditLog.js';
import { signSessionToken, IMPERSONATION_TTL } from '../lib/sessionTokens.js';
import type { PlatformRole } from '../middleware/platformAuth.js';

const IMPERSONATION_TTL_MS = 30 * 60 * 1000;

// docs/org-onboarding-spec.md §7.3 — mode is derived from the impersonating
// admin's own platform_role, not chosen by them: owner -> full write
// access, support -> read-only. No third option, no per-request override.
function modeForRole(role: PlatformRole): 'write' | 'read_only' {
  return role === 'owner' ? 'write' : 'read_only';
}

export async function startImpersonation(
  platformAdminPersonId: string,
  platformRole: PlatformRole,
  targetOrgId: string,
  targetPersonId: string,
  reason: string,
) {
  if (!reason.trim()) throw badRequest('A reason is required to start an impersonation session');

  const membership = await db
    .selectFrom('org_memberships')
    .innerJoin('people', 'people.id', 'org_memberships.person_id')
    .innerJoin('organisations', 'organisations.id', 'org_memberships.org_id')
    .select(['org_memberships.id', 'org_memberships.role', 'people.email', 'organisations.name as org_name'])
    .where('org_memberships.org_id', '=', targetOrgId)
    .where('org_memberships.person_id', '=', targetPersonId)
    .where('org_memberships.deleted_at', 'is', null)
    .executeTakeFirst();
  if (!membership) throw notFound('That person is not a member of that organisation');

  const mode = modeForRole(platformRole);
  const expiresAt = new Date(Date.now() + IMPERSONATION_TTL_MS);

  const session = await db
    .insertInto('impersonation_sessions')
    .values({
      platform_admin_person_id: platformAdminPersonId,
      target_org_membership_id: membership.id,
      reason,
      mode,
      expires_at: expiresAt,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  const sessionToken = signSessionToken(
    {
      sub: targetPersonId,
      org_id: targetOrgId,
      role: membership.role as 'admin' | 'viewer',
      impersonation: { session_id: session.id, mode, platform_admin_person_id: platformAdminPersonId },
    },
    IMPERSONATION_TTL,
  );

  await writeAuditLog({
    actorPersonId: platformAdminPersonId,
    actorContext: 'impersonating',
    orgId: targetOrgId,
    action: 'impersonation_started',
    details: { impersonation_session_id: session.id, target_person_id: targetPersonId, target_email: membership.email, mode, reason },
  });

  return {
    session_token: sessionToken,
    expires_at: expiresAt.toISOString(),
    mode,
    target: { org_id: targetOrgId, org_name: membership.org_name, email: membership.email, role: membership.role },
  };
}

export async function endImpersonation(actorPersonId: string, orgId: string, impersonationSessionId: string) {
  const session = await db.selectFrom('impersonation_sessions').selectAll().where('id', '=', impersonationSessionId).executeTakeFirst();
  if (!session) throw notFound('Impersonation session not found');
  if (!session.ended_at) {
    await db.updateTable('impersonation_sessions').set({ ended_at: sql`now()` }).where('id', '=', impersonationSessionId).execute();
  }

  await writeAuditLog({
    actorPersonId,
    actorContext: 'impersonating',
    orgId,
    action: 'impersonation_ended',
    details: { impersonation_session_id: impersonationSessionId },
  });

  return { ok: true };
}
