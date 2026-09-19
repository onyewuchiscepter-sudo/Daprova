import { env } from './env.js';
import { app } from './app.js';
import { runMigrationsToLatest } from './db/migrate.js';
import { reconcilePendingPayments } from './services/paymentService.js';
import { runBillingCycle } from './services/billing/index.js';

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
    // Pricing & billing: overdue invoices, monthly invoices + tier
    // re-evaluation, auto-finalising cohorts.
    setInterval(() => {
      runBillingCycle().catch((err) => console.error('[billing] failed', err));
    }, 60 * 60_000);
  })
  .catch((err) => {
    console.error('[daprova-api] migration failed, refusing to start', err);
    process.exit(1);
  });
