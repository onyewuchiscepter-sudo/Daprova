import { db } from '../db/index.js';
import { notFound, forbidden } from './errors.js';
import { newRefreshJti, signRefreshToken, signSessionToken, REFRESH_TOKEN_TTL_MS } from './sessionTokens.js';

export const REFRESH_COOKIE = 'daprova_refresh';
export const refreshCookieOpts = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/api/v1/auth',
};

// A session is always scoped to exactly one org membership — a person who
// belongs to more than one (docs/org-onboarding-spec.md §2) picks which via
// /auth/select-org or /auth/switch-org, but every issued session/refresh
// token pair remembers that choice explicitly (refresh_tokens.org_id),
// since it can no longer be derived implicitly from the person alone.
// Shared by every path that ends in a full login: /auth/verify,
// /auth/select-org, /auth/switch-org, /auth/refresh, and
// /invites/:token/accept.
export async function issueSession(personId: string, orgId: string) {
  const person = await db.selectFrom('people').selectAll().where('id', '=', personId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!person) throw notFound('Person not found');

  const membership = await db
    .selectFrom('org_memberships')
    .selectAll()
    .where('person_id', '=', personId)
    .where('org_id', '=', orgId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!membership) throw forbidden('Not a member of that organisation');

  const sessionToken = signSessionToken({ sub: person.id, org_id: membership.org_id, role: membership.role as 'admin' | 'viewer' });

  const jti = newRefreshJti();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  await db.insertInto('refresh_tokens').values({ person_id: person.id, org_id: membership.org_id, jti, expires_at: expiresAt }).execute();
  const refreshToken = signRefreshToken(person.id, jti);

  return { sessionToken, refreshToken, jti, person, membership };
}
