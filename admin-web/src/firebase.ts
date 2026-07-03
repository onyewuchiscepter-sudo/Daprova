import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';

// Emulator-only config — no real Firebase project needed. Must match
// FIREBASE_PROJECT_ID in api/src/env.ts so tokens verify against the same project.
const app = initializeApp({ projectId: 'daprova-dev', apiKey: 'fake-api-key' });

export const auth = getAuth(app);
connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
