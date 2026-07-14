import { env } from './env.js';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { orgRouter } from './routes/org.js';
import { frameworksRouter } from './routes/frameworks.js';
import { coursesRouter } from './routes/courses.js';
import { cohortsRouter } from './routes/cohorts.js';
import { reportsRouter } from './routes/reports.js';
import { assessRouter } from './routes/assess.js';
import { webhooksRouter } from './routes/webhooks.js';
import { bootstrapRouter } from './routes/bootstrap.js';
import { platformRouter } from './routes/platform.js';
import { invitesRouter } from './routes/invites.js';
import { signupRouter } from './routes/signup.js';
import { paymentsRouter } from './routes/payments.js';
import { errorHandler } from './lib/errors.js';
import { adminLimiter, publicLimiter } from './middleware/rateLimit.js';
import { runMigrationsToLatest } from './db/migrate.js';
import { reconcilePendingPayments } from './services/paymentService.js';

const app = express();

const allowedOrigins = new Set([env.adminDashboardOrigin, env.assessmentWebOrigin, env.platformWebOrigin]);
app.use(
  cors({
    origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)),
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());

app.use(healthRouter);

app.use('/api/v1/auth', publicLimiter, authRouter);
app.use('/api/v1', adminLimiter, orgRouter);
app.use('/api/v1/frameworks', adminLimiter, frameworksRouter);
app.use('/api/v1/courses', adminLimiter, coursesRouter);
app.use('/api/v1/cohorts', adminLimiter, cohortsRouter);
app.use('/api/v1/reports', adminLimiter, reportsRouter);
app.use('/api/v1/assess', publicLimiter, assessRouter);
app.use('/api/v1/webhooks', publicLimiter, webhooksRouter);
app.use('/api/v1/bootstrap', publicLimiter, bootstrapRouter);
app.use('/api/v1/platform', adminLimiter, platformRouter);
app.use('/api/v1/invites', publicLimiter, invitesRouter);
app.use('/api/v1/orgs', publicLimiter, signupRouter);
app.use('/api/v1/payments', publicLimiter, paymentsRouter);

app.use(errorHandler);

// Applying pending migrations on boot means schema changes ship with the
// deploy itself instead of needing a separate manual step against whatever's
// hosting the database. Fine for a single-instance deployment like this one;
// would need a separate migration step (not on every instance's boot) if this
// ever scaled to multiple concurrent API instances.
runMigrationsToLatest()
  .then(() => {
    app.listen(env.port, () => {
      console.log(`[daprova-api] listening on http://localhost:${env.port}`);
    });
    // docs/org-onboarding-spec.md §5.6 step 6 — reconciliation job. A fixed
    // interval on the single API process is enough at this scale; would
    // need to move to a dedicated worker/lock if this ever ran on more
    // than one instance concurrently.
    setInterval(() => {
      reconcilePendingPayments().catch((err) => console.error('[payment-reconciliation] failed', err));
    }, 60_000);
  })
  .catch((err) => {
    console.error('[daprova-api] migration failed, refusing to start', err);
    process.exit(1);
  });
