// Cloudflare Workers entry point. The same Express app as index.ts runs here
// through Workers' node:http compatibility; what differs is lifecycle:
// - No migrations on boot (a Worker has no single "boot"). `npm run deploy`
//   runs them against the database before publishing the new Worker.
// - The payment reconciliation and billing jobs that index.ts runs on setInterval are
//   Cron Triggers here (see "triggers" in wrangler.jsonc).
// - Each request/cron run gets its own DB pool via withRequestDb().
import { handleAsNodeRequest } from 'cloudflare:node';
import { app } from './app.js';
import { productionConfigProblem } from './env.js';
import { withRequestDb } from './db/index.js';
import { reconcilePendingPayments } from './services/paymentService.js';
import { runBillingCycle } from './services/billing/index.js';

interface Env {
  HYPERDRIVE: { connectionString: string };
}

const BILLING_CRON = '7 * * * *';

// Not a real network port — just the key handleAsNodeRequest dispatches on.
const PORT = 8080;
app.listen(PORT);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const problem = productionConfigProblem();
    if (problem) {
      console.error(`[daprova-api] ${problem}`);
      return Response.json({ error: { code: 'MISCONFIGURED', message: problem } }, { status: 500 });
    }
    return withRequestDb(env.HYPERDRIVE.connectionString, () => handleAsNodeRequest(PORT, request, env, ctx));
  },

  // Two Cron Triggers (wrangler.jsonc): every minute, payment reconciliation;
  // hourly, the billing job (overdue invoices, monthly invoices and tier
  // re-evaluation, auto-finalising cohorts).
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const billing = controller.cron === BILLING_CRON;
    ctx.waitUntil(
      withRequestDb(env.HYPERDRIVE.connectionString, async () => {
        const result = billing ? await runBillingCycle() : await reconcilePendingPayments();
        if (billing) console.log('[billing]', JSON.stringify(result));
      }).catch((err) => console.error(`[cron ${controller.cron}] failed`, err)),
    );
  },
};
