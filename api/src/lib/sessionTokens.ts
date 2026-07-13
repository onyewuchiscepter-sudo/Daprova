import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../env.js';
import type { SessionClaims } from '@daprova/shared';

const SESSION_TTL = '24h';
const REFRESH_TTL_SECS = 7 * 24 * 60 * 60; // 7 days

export function signSessionToken(claims: SessionClaims): string {
  return jwt.sign(claims, env.sessionJwtSecret, { expiresIn: SESSION_TTL });
}

export function verifySessionToken(token: string): SessionClaims {
  return jwt.verify(token, env.sessionJwtSecret) as SessionClaims;
}

export function newRefreshJti(): string {
  return crypto.randomUUID();
}

export function signRefreshToken(personId: string, jti: string): string {
  return jwt.sign({ sub: personId, jti }, env.refreshJwtSecret, { expiresIn: REFRESH_TTL_SECS });
}

export function verifyRefreshToken(token: string): { sub: string; jti: string } {
  return jwt.verify(token, env.refreshJwtSecret) as { sub: string; jti: string };
}

export const REFRESH_TOKEN_TTL_MS = REFRESH_TTL_SECS * 1000;

// Bridges Firebase verification to org selection for a person who belongs
// to more than one org (docs/org-onboarding-spec.md §2): proves "this
// person already presented a valid Firebase ID token" without needing to
// re-verify it, but deliberately carries no org context and expires in
// minutes, not hours — it's a hop, not a session.
const ORG_SELECTION_TTL = '5m';

export function signOrgSelectionToken(personId: string): string {
  return jwt.sign({ sub: personId, purpose: 'org_selection' }, env.sessionJwtSecret, { expiresIn: ORG_SELECTION_TTL });
}

export function verifyOrgSelectionToken(token: string): { sub: string } {
  const payload = jwt.verify(token, env.sessionJwtSecret) as { sub: string; purpose: string };
  if (payload.purpose !== 'org_selection') throw new Error('Not an org-selection token');
  return { sub: payload.sub };
}
