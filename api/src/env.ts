import 'dotenv/config';
import { IS_WORKERS } from './lib/runtime.js';

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
  // Sprint 3 (docs/org-onboarding-spec.md §8) — sends teammate-invite
  // emails. Not needed for Model B, which hands out credentials directly.
  resendApiKey: process.env.RESEND_API_KEY,
  inviteFromEmail: process.env.INVITE_FROM_EMAIL ?? 'onboarding@daprova.com',
  // The refresh cookie defaults to SameSite=Lax, which only works when the
  // frontends and the api share a registrable domain (app.daprova.com +
  // api.daprova.com). On split hosting domains (e.g. *.pages.dev frontends
  // calling a *.workers.dev api) the browser drops a Lax cookie on every fetch,
  // so session restore silently fails — set COOKIE_SAMESITE=none there.
  cookieSameSite: (process.env.COOKIE_SAMESITE === 'none' ? 'none' : 'lax') as 'none' | 'lax',
  // Express 'trust proxy' setting, so req.ip is the real client behind the
  // host's load balancer. Unset, every request appears to come from the
  // proxy and the per-IP rate limits become one shared global bucket.
  // A hop count ("1") or "true"; see https://expressjs.com/en/guide/behind-proxies.html
  trustProxy: process.env.TRUST_PROXY,
  // Payments (services/payments). Which provider new checkouts use:
  // "paystack" | "flutterwave" | "stub". Unset picks the first provider
  // whose secret key is present, falling back to the stub so the upgrade
  // flow still works end-to-end before real keys exist.
  paymentProvider: process.env.PAYMENT_PROVIDER,
  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY,
  flutterwaveSecretKey: process.env.FLUTTERWAVE_SECRET_KEY,
  // Flutterwave signs webhooks with a shared "secret hash" you choose in
  // its dashboard (Settings → Webhooks), sent back as the verif-hash header.
  flutterwaveWebhookHash: process.env.FLUTTERWAVE_WEBHOOK_HASH,
  // Learner reminders. Email goes through Resend (RESEND_API_KEY) from this
  // address, which must be on a domain verified in Resend.
  reminderFromEmail: process.env.REMINDER_FROM_EMAIL ?? process.env.INVITE_FROM_EMAIL ?? 'onboarding@daprova.com',
  // SMS through Termii (https://termii.com). TERMII_BASE_URL is the base URL
  // shown in your Termii dashboard; the sender ID must be approved there.
  termiiApiKey: process.env.TERMII_API_KEY,
  termiiSenderId: process.env.TERMII_SENDER_ID ?? 'Daprova',
  termiiBaseUrl: process.env.TERMII_BASE_URL ?? 'https://api.ng.termii.com',
  // This API's own public URL, for links that leave the app (logo images in
  // emails). Unset in local dev.
  apiPublicUrl: process.env.API_PUBLIC_URL,
};

// Never serve production traffic on known dev secrets or against the emulator.
export function productionConfigProblem(): string | null {
  if (env.nodeEnv !== 'production') return null;
  if (env.sessionJwtSecret === DEV_SESSION_SECRET || env.refreshJwtSecret === DEV_REFRESH_SECRET) {
    return 'Refusing to start in production with default dev JWT secrets — set SESSION_JWT_SECRET and REFRESH_JWT_SECRET.';
  }
  if (env.firebaseAuthEmulatorHost) return 'FIREBASE_AUTH_EMULATOR_HOST must not be set in production.';
  return null;
}

// On Node, fail at boot. On Workers a throw here would make Cloudflare reject
// the upload itself — before secrets can be attached to a never-deployed
// Worker — so worker.ts checks per request instead and answers 500.
if (!IS_WORKERS) {
  const problem = productionConfigProblem();
  if (problem) throw new Error(problem);
}
