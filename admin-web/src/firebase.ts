import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';

// Dual-mode, mirroring the backend's split in api/src/lib/firebaseAdmin.ts:
// with no real Firebase config baked in at build time, this falls back to
// the local emulator (fake project, no account needed) exactly as before.
// Set VITE_FIREBASE_API_KEY + VITE_FIREBASE_PROJECT_ID at build time (e.g.
// in Railway's build environment) to point at a real Firebase project instead
// — must match FIREBASE_PROJECT_ID on the API service so tokens verify.
const realApiKey = import.meta.env.VITE_FIREBASE_API_KEY;
const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'daprova-dev';

const app = initializeApp({
  projectId,
  apiKey: realApiKey ?? 'fake-api-key',
  authDomain: realApiKey ? `${projectId}.firebaseapp.com` : undefined,
});

export const auth = getAuth(app);
if (!realApiKey) {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
}
