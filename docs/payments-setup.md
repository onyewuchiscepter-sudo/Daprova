# Payments: switching on Paystack and/or Flutterwave

Org admins pay invoices from the **Billing** page. The API picks a gateway:

1. `PAYMENT_PROVIDER` if you set it (`paystack`, `flutterwave` or `stub`)
2. otherwise **Paystack** if `PAYSTACK_SECRET_KEY` is set
3. otherwise **Flutterwave** if `FLUTTERWAVE_SECRET_KEY` is set
4. otherwise, **outside production only**, a test checkout where no money moves

In production (`NODE_ENV=production`) the test checkout is switched off,
because anyone could use it to mark an invoice paid. Until a gateway key is
set, **Pay** tells the admin that online payment isn't available.

The platform console (**Payments** tab) shows which gateway is active,
whether each one's keys are set, and whether the Paystack key is a test or
live key.

Secrets go in Cloudflare as Worker secrets, never in `wrangler.jsonc`. Either
run `npx wrangler secret put <NAME>` from `api/` (it prompts for the value and
redeploys), or use **Cloudflare → Workers & Pages → daprova → Settings →
Variables and Secrets → Add → Type: Secret**, then **Deploy**.

## Paystack

Only the **secret key** is needed. Checkout runs on Paystack's hosted page,
so the public key isn't used.

| Where to get it | Secret name |
|---|---|
| Paystack dashboard → Settings → API Keys & Webhooks → **Secret key** (`sk_test_…` / `sk_live_…`) | `PAYSTACK_SECRET_KEY` |

```
cd api
npx wrangler secret put PAYSTACK_SECRET_KEY
```

On the same Paystack page, set **Webhook URL** for the matching mode (test
and live each have their own) to:

```
https://daprova.onyewuchiscepter.workers.dev/api/v1/webhooks/paystack
```

Paystack signs every webhook with your secret key, and the API checks that
signature. You don't need a separate webhook secret. You don't need to set
the dashboard's Callback URL either: each checkout passes its own, back to
the Billing page.

**Testing with a test key.** Pay any invoice from the Billing page and use
Paystack's test card `4084 0840 8408 4081`, any future expiry, CVV `408`,
PIN `0000`, OTP `123456`. You should land back on Billing with the invoice
marked paid, and the payment should show under platform console → Payments.

**Going live.** Activate the business in Paystack (compliance), then run
`wrangler secret put PAYSTACK_SECRET_KEY` again with the `sk_live_…` key
and set the live Webhook URL. Checkouts opened with the test key are
checked with whatever key is current, so they will be marked abandoned
after 24 hours; the invoices stay open and can be paid again.

**Local dev.** Put `PAYSTACK_SECRET_KEY=sk_test_…` in `api/.env` (Node) or
`api/.dev.vars` (`wrangler dev`). Both files are gitignored. Paystack can't
reach localhost, so locally the payment is confirmed by the Billing page's
check after the redirect and the every-minute reconciliation, not the webhook.

## Flutterwave

| Where to get it | Secret name |
|---|---|
| Flutterwave dashboard → Settings → API Keys → **Secret key** (`FLWSECK_TEST-…` / `FLWSECK-…`) | `FLUTTERWAVE_SECRET_KEY` |
| A long random string you choose (e.g. `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`) | `FLUTTERWAVE_WEBHOOK_HASH` |

In Flutterwave → Settings → **Webhooks**, set the URL to:

```
https://daprova.onyewuchiscepter.workers.dev/api/v1/webhooks/flutterwave
```

and paste the **same** random string as the **Secret hash**.

## Using both

With both keys set, Paystack takes new checkouts. To use Flutterwave instead,
add the secret `PAYMENT_PROVIDER` = `flutterwave`. Payments already open
with one gateway always finish with that gateway, even after you switch.

## How a payment is confirmed

- The org admin clicks **Pay** on an invoice and pays on the gateway's hosted
  page. The gateway sends them back to the Billing page, which asks the API
  to check the payment straight away. Clicking Pay again while a checkout is
  open reuses it rather than opening a second one.
- The API never trusts the redirect or the webhook body on its own. It asks
  the gateway for the transaction, checks it was paid in **NGN** for at least
  the invoice amount, and only then marks the invoice paid.
- A job runs every minute as a safety net for missed webhooks. Checkouts not
  completed within 24 hours are marked **abandoned**; the invoice stays open.
- Discounting, voiding or marking an invoice paid by hand cancels any open
  checkout for it.
