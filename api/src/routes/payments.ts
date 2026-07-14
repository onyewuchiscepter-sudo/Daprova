import { Router } from 'express';
import { z } from 'zod';
import { badRequest } from '../lib/errors.js';
import * as paymentService from '../services/paymentService.js';
import { simulateOutcome } from '../services/paymentProviderStub.js';

export const paymentsRouter = Router();

// Public — this stands in for a real Paystack/Flutterwave-hosted checkout
// page (docs/org-onboarding-spec.md §5.6): the admin is redirected off our
// app entirely for the real thing, so this deliberately isn't wrapped in
// admin-web's SPA or session auth either.
paymentsRouter.get('/stub-checkout/:reference', async (req, res, next) => {
  try {
    const { payment, tier } = await paymentService.getStubCheckoutInfo(req.params.reference);
    res.set('Content-Type', 'text/html').send(`
      <!doctype html><html><head><title>Stub Payment Checkout</title>
      <style>body{font-family:sans-serif;max-width:420px;margin:80px auto;text-align:center}
      button{padding:10px 20px;margin:8px;font-size:14px;cursor:pointer}
      .pay{background:#0f172a;color:white;border:none;border-radius:4px}
      .fail{background:white;border:1px solid #cbd5e1;border-radius:4px}</style>
      </head><body>
        <h2>Upgrade to ${tier.name}</h2>
        <p>Amount due: &#8358;${Number(payment.amount).toLocaleString()}</p>
        <p style="color:#64748b;font-size:12px">This is a stand-in checkout page (no real payment provider wired up yet).</p>
        <button class="pay" onclick="act('success')">Simulate successful payment</button>
        <button class="fail" onclick="act('failed')">Simulate failed payment</button>
        <p id="result"></p>
        <script>
          async function act(outcome) {
            const res = await fetch(window.location.pathname + '/simulate', {
              method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ outcome })
            });
            const body = await res.json();
            document.getElementById('result').textContent = res.ok
              ? 'Recorded at the provider — waiting for your webhook or reconciliation job to pick it up.'
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
    // Deliberately only updates the stub provider's own state, not our
    // `payments` row — that's the whole point of the reconciliation job
    // (paymentJobs.ts): a real provider's "it succeeded" doesn't reach us
    // instantly just because the customer clicked something on their page.
    simulateOutcome(req.params.reference, body.data.outcome);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
