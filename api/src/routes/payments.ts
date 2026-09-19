import { Router } from 'express';
import { z } from 'zod';
import { badRequest } from '../lib/errors.js';
import { env } from '../env.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import * as paymentService from '../services/paymentService.js';
import { simulateStubOutcome } from '../services/payments/stub.js';

export const paymentsRouter = Router();

// Payment history for the signed-in org.
paymentsRouter.get('/', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    res.json(await paymentService.listPayments(req.auth!.org_id!));
  } catch (err) {
    next(err);
  }
});

// The provider redirects the admin back to /cohorts/:id?payment=<ref>;
// admin-web calls this so the upgrade applies immediately rather than on
// the next reconciliation tick. The outcome still comes from asking the
// provider, never from the redirect itself.
paymentsRouter.post('/:reference/verify', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    res.json(await paymentService.verifyPaymentForOrg(req.auth!.org_id!, req.params.reference));
  } catch (err) {
    next(err);
  }
});

// Public — the stub provider's stand-in for a Paystack/Flutterwave-hosted
// checkout page. Only used while no real provider keys are configured.
paymentsRouter.get('/stub-checkout/:reference', async (req, res, next) => {
  try {
    const { payment, label } = await paymentService.getStubCheckoutInfo(req.params.reference);
    // Same return trip a real gateway makes after checkout.
    const returnUrl = `${env.adminDashboardOrigin}/billing?payment=${payment.reference}`;
    res.set('Content-Type', 'text/html').send(`
      <!doctype html><html><head><title>Test checkout</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>body{font-family:system-ui,sans-serif;max-width:420px;margin:80px auto;padding:0 16px;text-align:center;color:#0f172a}
      button{padding:10px 20px;margin:8px;font-size:14px;cursor:pointer;border-radius:6px}
      .pay{background:#0f766e;color:white;border:none}.fail{background:white;border:1px solid #cbd5e1}
      .note{color:#64748b;font-size:12px}</style>
      </head><body>
        <h2>${label.replace(/[<>&"]/g, '')}</h2>
        <p>Amount due: &#8358;${Number(payment.amount).toLocaleString()}</p>
        <p class="note">Test checkout — no real payment gateway is connected yet, so no money moves.</p>
        <button class="pay" onclick="act('success')">Simulate successful payment</button>
        <button class="fail" onclick="act('failed')">Simulate failed payment</button>
        <p id="result"></p>
        <script>
          async function act(outcome) {
            const res = await fetch(window.location.pathname + '/simulate', {
              method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ outcome })
            });
            const body = await res.json().catch(() => ({}));
            if (res.ok) setTimeout(() => { window.location.href = ${JSON.stringify(returnUrl)}; }, 800);
            document.getElementById('result').textContent = res.ok
              ? 'Recorded. Returning you to Daprova…'
              : (body.error?.message || 'Something went wrong');
          }
        </script>
      </body></html>
    `);
  } catch (err) {
    next(err);
  }
});

const simulateSchema = z.object({ outcome: z.enum(['success', 'failed']) });
paymentsRouter.post('/stub-checkout/:reference/simulate', async (req, res, next) => {
  try {
    const body = simulateSchema.safeParse(req.body);
    if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
    // Only updates the stub provider's own state, not our payments row —
    // that gets resolved the same way as for a real provider.
    await paymentService.getStubCheckoutInfo(req.params.reference);
    await simulateStubOutcome(req.params.reference, body.data.outcome);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
