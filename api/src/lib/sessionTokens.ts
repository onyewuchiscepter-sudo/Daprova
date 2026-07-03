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

export function signRefreshToken(userId: string, jti: string): string {
  return jwt.sign({ sub: userId, jti }, env.refreshJwtSecret, { expiresIn: REFRESH_TTL_SECS });
}

export function verifyRefreshToken(token: string): { sub: string; jti: string } {
  return jwt.verify(token, env.refreshJwtSecret) as { sub: string; jti: string };
}

export const REFRESH_TOKEN_TTL_MS = REFRESH_TTL_SECS * 1000;
