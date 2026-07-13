import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var ${name}`);
  return v;
}

const DEV_SESSION_SECRET = 'dev-insecure-session-secret-change-me';
const DEV_REFRESH_SECRET = 'dev-insecure-refresh-secret-change-me';

export const env = {
  port: Number(process.env.PORT ?? 4001),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl: required('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/daprova_dev'),
  sessionJwtSecret: required('SESSION_JWT_SECRET', DEV_SESSION_SECRET),
  refreshJwtSecret: required('REFRESH_JWT_SECRET', DEV_REFRESH_SECRET),
  firebaseProjectId: required('FIREBASE_PROJECT_ID', 'daprova-dev'),
  // Set only for local dev — its presence is what switches auth verification
  // between the emulator's lenient REST lookup and real JWKS-based JWT
  // verification (see lib/firebaseAdmin.ts). Must be unset in production.
  firebaseAuthEmulatorHost: process.env.FIREBASE_AUTH_EMULATOR_HOST,
  // The project's public Web API key (same value admin-web's
  // VITE_FIREBASE_API_KEY uses) — not a service-account secret. Only needed
  // server-side for Model B's "team creates an org admin directly" flow
  // (routes/platform.ts), which calls the same public Identity Toolkit
  // signUp REST endpoint the Firebase client SDK uses, rather than pulling
  // in firebase-admin for this one capability.
  firebaseApiKey: process.env.FIREBASE_API_KEY,
  adminDashboardOrigin: process.env.ADMIN_DASHBOARD_ORIGIN ?? 'http://localhost:5173',
  assessmentWebOrigin: process.env.ASSESSMENT_WEB_ORIGIN ?? 'http://localhost:5174',
  // The internal platform-admin tool (platform-web) — a separate surface
  // from the customer-facing admin-web, per docs/org-onboarding-spec.md §7.5.
  platformWebOrigin: process.env.PLATFORM_WEB_ORIGIN ?? 'http://localhost:5175',
  // Gates POST /api/v1/bootstrap (routes/bootstrap.ts) — a one-time endpoint
  // for provisioning the first org+admin user in a freshly deployed
  // environment with no direct DB access. Unset entirely (the default) means
  // the route always 404s; it also self-disables once any organisation
  // exists, so it can't function as a standing backdoor either way.
  bootstrapSecret: process.env.BOOTSTRAP_SECRET,
};

// Fail fast rather than silently run production traffic on known dev secrets
// or against the emulator.
if (env.nodeEnv === 'production') {
  if (env.sessionJwtSecret === DEV_SESSION_SECRET || env.refreshJwtSecret === DEV_REFRESH_SECRET) {
    throw new Error('Refusing to start in production with default dev JWT secrets — set SESSION_JWT_SECRET and REFRESH_JWT_SECRET.');
  }
  if (env.firebaseAuthEmulatorHost) {
    throw new Error('FIREBASE_AUTH_EMULATOR_HOST must not be set in production.');
  }
}
