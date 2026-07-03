import { Router } from 'express';
import { db } from '../db/index.js';
import { firebaseAuth } from '../lib/firebaseAdmin.js';
import { unauthorized, notFound } from '../lib/errors.js';
import {
  newRefreshJti,
  signRefreshToken,
  signSessionToken,
  verifyRefreshToken,
  REFRESH_TOKEN_TTL_MS,
} from '../lib/sessionTokens.js';

export const authRouter = Router();

const REFRESH_COOKIE = 'daprova_refresh';
const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/api/v1/auth',
};

async function issueSession(userId: string) {
  const user = await db
    .selectFrom('users')
    .selectAll()
    .where('id', '=', userId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!user) throw notFound('User not found');

  const sessionToken = signSessionToken({ sub: user.id, org_id: user.org_id, role: user.role as 'admin' | 'viewer' });

  const jti = newRefreshJti();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  await db.insertInto('refresh_tokens').values({ user_id: user.id, jti, expires_at: expiresAt }).execute();
  const refreshToken = signRefreshToken(user.id, jti);

  return { sessionToken, refreshToken, user };
}

// B5.1 steps 3-6: verify the Firebase/emulator-issued ID token, then issue our own
// short-lived session token + rotated refresh token.
authRouter.post('/verify', async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized('Missing Firebase ID token');
    const idToken = header.slice('Bearer '.length);

    const decoded = await firebaseAuth.verifyIdToken(idToken).catch(() => {
      throw unauthorized('Invalid Firebase ID token');
    });

    const user = await db
      .selectFrom('users')
      .selectAll()
      .where('auth_uid', '=', decoded.uid)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!user) throw notFound('No Daprova account provisioned for this login');

    await db.updateTable('users').set({ last_login_at: new Date() }).where('id', '=', user.id).execute();

    const { sessionToken, refreshToken } = await issueSession(user.id);
    res.cookie(REFRESH_COOKIE, refreshToken, cookieOpts);
    res.json({
      session_token: sessionToken,
      user: { id: user.id, email: user.email, display_name: user.display_name, role: user.role, org_id: user.org_id },
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/refresh', async (req, res, next) => {
  try {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw unauthorized('Missing refresh token');

    const { jti } = await Promise.resolve(verifyRefreshToken(token)).catch(() => {
      throw unauthorized('Invalid refresh token');
    });

    const stored = await db
      .selectFrom('refresh_tokens')
      .selectAll()
      .where('jti', '=', jti)
      .executeTakeFirst();
    if (!stored || stored.revoked_at || new Date(stored.expires_at as unknown as string) < new Date()) {
      throw unauthorized('Refresh token no longer valid');
    }

    // Rotation: revoke the presented token, issue a brand new one.
    await db.updateTable('refresh_tokens').set({ revoked_at: new Date() }).where('id', '=', stored.id).execute();
    const { sessionToken, refreshToken } = await issueSession(stored.user_id);
    res.cookie(REFRESH_COOKIE, refreshToken, cookieOpts);
    res.json({ session_token: sessionToken });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', async (req, res, next) => {
  try {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (token) {
      try {
        const { jti } = verifyRefreshToken(token);
        await db.updateTable('refresh_tokens').set({ revoked_at: new Date() }).where('jti', '=', jti).execute();
      } catch {
        // already invalid/expired — nothing to revoke
      }
    }
    res.clearCookie(REFRESH_COOKIE, { path: cookieOpts.path });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
