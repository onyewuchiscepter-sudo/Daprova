# Reminders: email, SMS and WhatsApp

On a cohort page, **Send reminders** nudges learners who haven't finished a
step: the post-assessment, the feedback survey or the follow-up survey. Every
message carries the learner's **personal link**, which also lets them finish
on a different phone from the one they started on. A learner is never sent
the same reminder on the same channel twice within 20 hours.

Learners are only messaged if they gave an email or phone number **and**
ticked the consent box on the assessment's first page.

| Channel | Works today? | What it needs |
|---|---|---|
| **WhatsApp** | ✅ Yes | Nothing. Each learner gets a button that opens the admin's own WhatsApp with the message ready to send. |
| **Copy link** | ✅ Yes | Nothing. Copies a learner's personal link to share any way you like. |
| **Email** | ⚠️ Needs a verified domain | `RESEND_API_KEY` (already set) + a sending domain verified in Resend |
| **SMS** | ⏳ Needs keys | A Termii account |

All secrets go in **Cloudflare → Workers & Pages → daprova → Settings →
Variables and Secrets → Add → Type: Secret**, then **Deploy**.

## Email (Resend)

Resend only sends from a domain you've proven you own. Emails currently come
from `onboarding@daprova.com`, so:

1. Resend dashboard → **Domains → Add domain** → `daprova.com`.
2. Add the DNS records Resend shows at your domain registrar, then click
   **Verify** (usually minutes, can take a few hours).
3. Optional: to send from a different address, add the secret
   `REMINDER_FROM_EMAIL`, e.g. `Daprova <reminders@daprova.com>`.

Until the domain is verified, email reminders are reported as failed with
Resend's reason, and nothing is sent.

## SMS (Termii)

1. Create an account at https://termii.com and fund the wallet.
2. Request a **Sender ID** (e.g. `Daprova`). Nigerian networks require an
   approved sender ID.
3. Add these secrets:

| Secret | Value |
|---|---|
| `TERMII_API_KEY` | Termii dashboard → API key |
| `TERMII_SENDER_ID` | your approved sender ID (defaults to `Daprova`) |
| `TERMII_BASE_URL` | the base URL shown in your Termii dashboard, e.g. `https://v3.api.termii.com` (defaults to `https://api.ng.termii.com`) |

Phone numbers in Nigerian local format (`0803…`) are converted to `234803…`
automatically. Other countries need the country code.
