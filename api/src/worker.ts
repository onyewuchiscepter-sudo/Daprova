// Cloudflare Workers entry point. The same Express app as index.ts runs here
// through Workers' node:http compatibility; what differs is lifecycle:
// - No migrations on boot (a Worker has no single "boot"). `npm run deploy`
//   runs them against the database before publishing the new Worker.
// - The payment reconciliation job that index.ts runs on setInterval is a
//   Cron Trigger here (see "triggers" in wrangler.jsonc).
// - Each request/cron run gets its own DB pool via withRequestDb().
import { handleAsNodeRequest } from 'cloudflare:node';
import { app } from './app.js';
import { productionConfigProblem } from './env.js';
import { withRequestDb } from './db/index.js';
import { reconcilePendingPayments } from './services/paymentService.js';

interface Env {
  HYPERDRIVE: { connectionString: string };
}

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

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      withRequestDb(env.HYPERDRIVE.connectionString, () => reconcilePendingPayments()).catch((err) =>
        console.error('[payment-reconciliation] failed', err),
      ),
    );
  },
};
