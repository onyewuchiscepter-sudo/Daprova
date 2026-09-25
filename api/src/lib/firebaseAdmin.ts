import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { env } from '../env.js';

// Two verification paths, switched by whether FIREBASE_AUTH_EMULATOR_HOST is
// set (local dev only — env.ts refuses to start in production with it set):
//
// - Emulator: tokens aren't cryptographically signed with real Google keys,
//   so firebase-admin itself just forwards to this same Identity Toolkit
//   REST API under the hood. Calling it directly with `fetch` avoids
//   firebase-admin's entire google-gax/grpc-js/protobufjs dependency tree
//   (hundreds of small files that made npm install painfully slow under
//   Windows Defender real-time scanning) for a capability that's three
//   fetch calls against the emulator.
// - Real project: tokens are signed RS256 JWTs. `jose` verifies the
//   signature against Google's published JWKS and checks issuer/audience/
//   expiry — the same checks firebase-admin does, without the heavy SDK.
const EMULATOR_BASE = env.firebaseAuthEmulatorHost ? `http://${env.firebaseAuthEmulatorHost}/identitytoolkit.googleapis.com/v1` : null;
const REAL_BASE = 'https://identitytoolkit.googleapis.com/v1';
const EMULATOR_KEY = 'fake-api-key';

async function callIdentityToolkit<T>(path: string, body: unknown): Promise<T> {
  const base = EMULATOR_BASE ?? REAL_BASE;
  const key = EMULATOR_BASE ? EMULATOR_KEY : env.firebaseApiKey;
  if (!key) throw new Error('FIREBASE_API_KEY is required to call Identity Toolkit against a real Firebase project');

  const res = await fetch(`${base}${path}?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: { message: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `Identity Toolkit request failed: ${res.status}`);
  return json;
}

// Google's published signing keys for Firebase ID tokens.
//
// Deliberately fetched here rather than via jose's createRemoteJWKSet: that
// keeps a shared in-flight fetch on the module object, and on Workers a
// promise created by one request can't be awaited by another ("Cannot
// perform I/O on behalf of a different request"), which would fail sign-ins
// at random. Only the parsed keys — plain JSON — are cached across requests.
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const JWKS_TTL_MS = 60 * 60 * 1000;
let cachedJwks: { keys: JSONWebKeySet; fetchedAt: number } | null = null;

async function fetchJwks(): Promise<JSONWebKeySet> {
  let res: Response;
  try {
    res = await fetch(JWKS_URL);
  } catch (err) {
    throw new TokenCheckError('JWKS_FETCH_FAILED', `Could not reach Google's key server: ${(err as Error).message}`);
  }
  if (!res.ok) throw new TokenCheckError('JWKS_FETCH_FAILED', `Google's key server answered ${res.status}`);
  const keys = (await res.json()) as JSONWebKeySet;
  if (!keys?.keys?.length) throw new TokenCheckError('JWKS_EMPTY', "Google's key server returned no keys");
  cachedJwks = { keys, fetchedAt: Date.now() };
  return keys;
}

// Carries a short code so a rejected sign-in can say why without ever
// exposing the token itself.
export class TokenCheckError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function verifyRealIdToken(idToken: string): Promise<{ uid: string; email?: string }> {
  const fresh = cachedJwks && Date.now() - cachedJwks.fetchedAt < JWKS_TTL_MS;
  let keys = fresh ? cachedJwks!.keys : await fetchJwks();

  const verify = async () =>
    jwtVerify(idToken, createLocalJWKSet(keys), {
      issuer: `https://securetoken.google.com/${env.firebaseProjectId}`,
      audience: env.firebaseProjectId,
      // Google rotates these keys; a little slack avoids rejecting a token
      // that is valid either side of a clock difference.
      clockTolerance: 60,
    });

  let payload;
  try {
    ({ payload } = await verify());
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'ERR_JWT_INVALID';
    // Signed with a key we don't have yet (Google rotates them): refresh once.
    if (code === 'ERR_JWKS_NO_MATCHING_KEY' && fresh) {
      keys = await fetchJwks();
      try {
        ({ payload } = await verify());
      } catch (retryErr) {
        throw new TokenCheckError((retryErr as { code?: string }).code ?? 'ERR_JWT_INVALID', (retryErr as Error).message);
      }
    } else {
      throw new TokenCheckError(code, (err as Error).message);
    }
  }
  if (!payload.sub) throw new TokenCheckError('ERR_JWT_NO_SUB', 'ID token has no subject claim');
  return { uid: payload.sub, email: typeof payload.email === 'string' ? payload.email : undefined };
}

export const firebaseAuth = {
  async verifyIdToken(idToken: string): Promise<{ uid: string; email?: string }> {
    if (!EMULATOR_BASE) return verifyRealIdToken(idToken);

    const data = await callIdentityToolkit<{ users?: Array<{ localId: string; email?: string }> }>('/accounts:lookup', { idToken });
    const user = data.users?.[0];
    if (!user) throw new Error('Invalid ID token');
    return { uid: user.localId, email: user.email };
  },

  // Dev-only — used by the seed script to provision local test users against
  // the emulator. Not meaningful in production, where real users sign in
  // through the actual Firebase-backed login UI.
  async signInWithPassword(email: string, password: string): Promise<{ uid: string }> {
    if (!EMULATOR_BASE) throw new Error('signInWithPassword is only available against the emulator');
    const data = await callIdentityToolkit<{ localId: string }>('/accounts:signInWithPassword', { email, password, returnSecureToken: true });
    return { uid: data.localId };
  },

  // Firebase emails the person a link to choose their own password. Used by
  // the platform console to set up staff logins and to help a customer who
  // is locked out, so nobody at Daprova ever handles a password.
  async sendPasswordResetEmail(email: string): Promise<void> {
    await callIdentityToolkit('/accounts:sendOobCode', { requestType: 'PASSWORD_RESET', email });
  },

  // Used by the dev seed script (against the emulator) and by Model B's
  // team-provisioned org creation (routes/platform.ts, against a real
  // project) — the same public signUp REST call either way, just a
  // different key/base URL depending on which `callIdentityToolkit` picks.
  async createUser(opts: { email: string; password: string; emailVerified?: boolean }): Promise<{ uid: string }> {
    const data = await callIdentityToolkit<{ localId: string }>('/accounts:signUp', {
      email: opts.email,
      password: opts.password,
      returnSecureToken: true,
    });
    return { uid: data.localId };
  },
};
