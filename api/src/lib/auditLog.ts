import { db } from '../db/index.js';

export type AuditActorContext = 'org_admin' | 'platform_admin' | 'impersonating';

export async function writeAuditLog(opts: {
  actorPersonId: string | null;
  actorContext: AuditActorContext;
  orgId?: string | null;
  action: string;
  details?: unknown;
}) {
  await db
    .insertInto('audit_log')
    .values({
      actor_person_id: opts.actorPersonId,
      actor_context: opts.actorContext,
      org_id: opts.orgId ?? null,
      action: opts.action,
      details: opts.details ?? null,
    })
    .execute();
}
