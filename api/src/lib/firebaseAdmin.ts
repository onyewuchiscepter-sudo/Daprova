import { createRemoteJWKSet, jwtVerify } from 'jose';
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
const KEY = 'fake-api-key';

async function callIdentityToolkit<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${EMULATOR_BASE}${path}?key=${KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: { message: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `Identity Toolkit request failed: ${res.status}`);
  return json;
}

// Google's published JWKS for Firebase ID tokens — cached and auto-refreshed by jose.
const googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

async function verifyRealIdToken(idToken: string): Promise<{ uid: string; email?: string }> {
  const { payload } = await jwtVerify(idToken, googleJwks, {
    issuer: `https://securetoken.google.com/${env.firebaseProjectId}`,
    audience: env.firebaseProjectId,
  });
  if (!payload.sub) throw new Error('ID token missing sub claim');
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

  // Dev-only helpers used by the seed script to provision local test users —
  // not called in production, where real users sign up through the actual
  // Firebase-backed login UI.
  async signInWithPassword(email: string, password: string): Promise<{ uid: string }> {
    if (!EMULATOR_BASE) throw new Error('signInWithPassword is only available against the emulator');
    const data = await callIdentityToolkit<{ localId: string }>('/accounts:signInWithPassword', { email, password, returnSecureToken: true });
    return { uid: data.localId };
  },

  async createUser(opts: { email: string; password: string; emailVerified?: boolean }): Promise<{ uid: string }> {
    if (!EMULATOR_BASE) throw new Error('createUser is only available against the emulator');
    const data = await callIdentityToolkit<{ localId: string }>('/accounts:signUp', {
      email: opts.email,
      password: opts.password,
      returnSecureToken: true,
    });
    return { uid: data.localId };
  },
};
