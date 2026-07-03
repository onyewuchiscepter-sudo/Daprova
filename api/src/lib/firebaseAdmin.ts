import { env } from '../env.js';

// Lightweight replacement for the `firebase-admin` SDK. Against the Auth
// emulator, firebase-admin doesn't do real cryptographic JWT verification
// anyway — it just forwards to this same Identity Toolkit REST API. Calling
// it directly with `fetch` avoids pulling in firebase-admin's entire
// google-gax/grpc-js/protobufjs dependency tree (hundreds of small files that
// make npm install painfully slow, especially under Windows Defender
// real-time scanning) for a capability we get from three fetch calls.
//
// NOTE: this only works against the emulator. A real Firebase project would
// need actual signature verification (firebase-admin, or jose + JWKS) — swap
// this module out at that point, the call sites (verifyIdToken/getUserByEmail/
// createUser) are the same shape either way.

const BASE = `http://${env.firebaseAuthEmulatorHost}/identitytoolkit.googleapis.com/v1`;
const KEY = 'fake-api-key';

async function callIdentityToolkit<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}?key=${KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: { message: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `Identity Toolkit request failed: ${res.status}`);
  return json;
}

export const firebaseAuth = {
  async verifyIdToken(idToken: string): Promise<{ uid: string; email?: string }> {
    const data = await callIdentityToolkit<{ users?: Array<{ localId: string; email?: string }> }>(
      '/accounts:lookup',
      { idToken },
    );
    const user = data.users?.[0];
    if (!user) throw new Error('Invalid ID token');
    return { uid: user.localId, email: user.email };
  },

  // Looking a user up by email alone (no password/idToken) is an admin-only
  // operation even against the emulator — accounts:lookup rejects it with
  // MISSING_ID_TOKEN unauthenticated. signInWithPassword is the one
  // unauthenticated endpoint that returns a uid for an existing user, so
  // that's what callers needing "does this user already exist" use instead.
  async signInWithPassword(email: string, password: string): Promise<{ uid: string }> {
    const data = await callIdentityToolkit<{ localId: string }>('/accounts:signInWithPassword', {
      email,
      password,
      returnSecureToken: true,
    });
    return { uid: data.localId };
  },

  async createUser(opts: { email: string; password: string; emailVerified?: boolean }): Promise<{ uid: string }> {
    const data = await callIdentityToolkit<{ localId: string }>('/accounts:signUp', {
      email: opts.email,
      password: opts.password,
      returnSecureToken: true,
    });
    return { uid: data.localId };
  },
};
