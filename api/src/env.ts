import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var ${name}`);
  return v;
}

export const env = {
  port: Number(process.env.PORT ?? 4001),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl: required('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/daprova_dev'),
  sessionJwtSecret: required('SESSION_JWT_SECRET', 'dev-insecure-session-secret-change-me'),
  refreshJwtSecret: required('REFRESH_JWT_SECRET', 'dev-insecure-refresh-secret-change-me'),
  firebaseProjectId: required('FIREBASE_PROJECT_ID', 'daprova-dev'),
  firebaseAuthEmulatorHost: process.env.FIREBASE_AUTH_EMULATOR_HOST ?? 'localhost:9099',
  adminDashboardOrigin: process.env.ADMIN_DASHBOARD_ORIGIN ?? 'http://localhost:5173',
};
