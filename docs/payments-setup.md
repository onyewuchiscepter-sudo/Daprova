# Payments: switching on Paystack and/or Flutterwave

Upgrades already work end to end with a **test checkout** (no money moves).
The API picks a gateway automatically:

1. `PAYMENT_PROVIDER` if you set it (`paystack`, `flutterwave` or `stub`)
2. otherwise **Paystack** if `PAYSTACK_SECRET_KEY` is set
3. otherwise **Flutterwave** if `FLUTTERWAVE_SECRET_KEY` is set
4. otherwise the test checkout

The platform tool (**Payments** card) shows which one is active and whether
each gateway's keys are set.

All secrets below go in **Cloudflare → Workers & Pages → daprova → Settings →
Variables and Secrets → Add → Type: Secret** (the runtime section, not Build),
then **Deploy**. Start with **test** keys, then swap to live keys.

## Paystack

| Where to get it | Secret name |
|---|---|
| Paystack dashboard → Settings → API Keys & Webhooks → **Secret key** (`sk_test_…` / `sk_live_…`) | `PAYSTACK_SECRET_KEY` |

On the same Paystack page, set **Webhook URL** to:

```
https://daprova.onyewuchiscepter.workers.dev/api/v1/webhooks/paystack
```

Paystack signs every webhook with your secret key, and the API checks that
signature. You don't need a separate webhook secret.

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

- The org admin clicks **Upgrade** and pays on the gateway's hosted page. The
  gateway sends them back to the cohort page, which asks the API to check the
  payment straight away.
- The API never trusts the redirect or the webhook body on its own. It asks
  the gateway for the transaction, checks it was paid in **NGN** for at least
  the invoice amount, and only then moves the cohort to the new plan.
- A job runs every minute as a safety net for missed webhooks. Checkouts not
  completed within 24 hours are marked **abandoned**, and any cohort locked
  for a capacity upgrade is unlocked.
