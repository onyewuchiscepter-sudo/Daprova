# Pricing & billing (pricing version 2026-09-v1)

Pricing is per **organisation**, not per cohort. The tiers are stored in the
`pricing_tiers` table (versioned; an org keeps its `pricing_version` until
moved on purpose). Code: `api/src/services/billing/`.

## Tiers

| | Starter | Growth | Scale | Enterprise |
|---|---|---|---|---|
| Learners / year | 0–249 | 250–499 | 500–999 | 1,000+ (contact sales) |
| Base fee, monthly | ₦25,000 | ₦33,000 | ₦40,000 | custom |
| Base fee, per cohort cycle | ₦85,000 | ₦112,000 | ₦135,000 | custom |
| Assessment + certificate, per learner | ₦1,000 | ₦1,000 | ₦1,000 | ₦800 |
| Concurrent cohorts | 1 | 3 | unlimited | unlimited |
| Funder reports / year (extra) | 1 (₦25,000) | 2 (₦18,000) | 4 (₦10,000) | negotiated |

Features per tier (equity dashboard, tracer survey, funder links, comparison,
analytics level) are in the tier's `features` JSON. The API enforces them
(`403 UPGRADE_REQUIRED`); the admin app shows an upgrade prompt.

## How money is charged

- **Base fee**: monthly orgs get one invoice per month from `billing_started_at`.
  Per-cohort-cycle orgs get one when each cohort is created.
- **Assessment fee**: charged when a cohort is **finalised**, for each learner
  who completed both pre and post, at the tier in effect then. Admins finalise
  from the cohort page; the hourly job auto-finalises 14 days after `end_date`.
- **Extra funder reports**: past the yearly quota (the year runs from the org's
  signup anniversary), the admin confirms the fee and a `report_overage`
  invoice is created. Previews and regenerating an existing report are free.
- **Free trial**: the first cohort has no base fee, and assessments for up to
  50 learners are free. Billing starts when that cohort is finalised or a
  second cohort is created. Platform admins can grant more free cohorts.
- Invoices are due in 7 days. Once one is **14 days overdue**, new cohorts and
  new funder reports are blocked until it's paid. Running cohorts are not affected.

## Tier changes

The trailing-12-month count covers distinct learners with a completed
assessment. It is re-checked at each billing boundary. Upgrades apply at the
next boundary. Downgrades apply only at renewal, and for per-cycle orgs only
when no cohort is open. Nothing is backdated.

Reaching 1,000+ learners (or projecting that many at signup) puts the org on
`pending_manual_quote`: new cohorts stop until a platform admin sets a
custom Enterprise agreement.

A plan set by hand in the platform console holds until the next renewal. It
then follows volume again, unless it was locked (see "Changing an org's
plan" below) or the org is on a custom Enterprise agreement.

## Jobs

- Workers: the Cron Trigger `7 * * * *` runs `runBillingCycle()`. It marks overdue
  invoices, rolls monthly periods, re-evaluates tiers and auto-finalises cohorts.
  Node runs the same job hourly.
- Platform console → Overview → **Run billing job now** triggers it on demand.

## Credits and discounts

- **Account credit** (org page → Credit): a balance used automatically before
  anything is charged on the org's next invoices, shown as an "Account credit
  applied" line. Use it for prepayments or goodwill. A negative amount removes credit.
- **Discount** (any unpaid invoice → Discount): takes an amount off with a
  reason printed on the invoice. A discount down to ₦0 settles the invoice. Any
  checkout already open for the old amount is cancelled, so the customer pays the new total.
- Marking an invoice paid or voiding it also cancels any open checkout for it.

## Platform console

Sign in at the platform site. The tabs:

- **Overview**: money collected (month, year, all time, last 6 months), recurring
  base fees, what's awaiting payment and overdue, orgs by plan and status, usage
  in the last 30 days, and anything waiting for review. Owners can run the billing job here.
- **Organisations**: search, filter by plan, billing state and verification,
  and sort by amount owed or last active. Create an org for a sales-led deal; leave the
  password empty and the admin gets an email to set their own.
- **Org page**: verify, suspend, reactivate, ban, close or reopen. Also: edit
  name and billing email, change plan and pricing, grant a free cohort, set
  billing status, add or remove credit, discount, remind, mark paid or void invoices,
  change member roles or remove members (the last admin is protected), send a
  password-reset email, impersonate, invite, resend or revoke invites, see
  cohorts and the org's recent activity.
- **Invoices**: every org's invoices, filtered by status and searchable by number or org.
- **Payments**: gateway status, recent checkouts, and "check pending payments now".
- **Review**: orgs awaiting verification and signup fraud flags.
- **Announcements**: a banner in the org app for everyone, one plan, or one org,
  with an optional end date. It can also be emailed to those orgs' admins.
- **Team**: platform staff. Adding someone new creates their login and Firebase
  emails them a link to set a password. The last owner can't be removed or demoted.
- **Activity**: the full audit log, filterable by action and person, with paging.

**Roles.** *Owner* can do everything. *Support* can view everything and can
verify orgs, review fraud flags, impersonate (read-only), send invoice
reminders, password resets and invite re-sends. Support can't create orgs or
change money, plans, account status, members or staff.

**Changing an org's plan** (org page, Plan & pricing, then Change plan; owners only):
pick the plan, then optionally:
- **Keep this plan whatever their learner numbers do.** This locks the plan,
  indefinitely or until a date. While locked, the automatic change at renewal
  and the 1,000+ learner Enterprise hold don't apply. Untick it to hand the
  plan back to their learner numbers from the next renewal.
- **Invoice the base-fee difference for the rest of this month.** This applies to
  upgrades on monthly billing after the free trial. A `plan_change` invoice
  is issued now, pro-rated to the days left in the month.
- **Email the organisation** that their plan changed.

Features change the moment the plan is saved. Without a lock, a manual plan change
lasts until the next renewal, when the plan follows their learner numbers again.

**Reasons.** Suspending, reactivating, closing, reopening or banning an org,
granting a free cohort, changing billing status or pricing, and marking an
invoice paid or void all require a reason. It's saved in the activity log.

**Access takes effect immediately.** Every request re-checks the org's status and
the person's membership and role. Suspending or closing an org, removing a member or
changing their role applies on their next click, not when their 24-hour
session runs out. Ending an impersonation stops it at once. An impersonation
session can never use the platform console or switch organisations. Staff
sign in to the console with a session that belongs to no organisation, so
suspending an org they also belong to doesn't lock them out.

**Setup secret.** `BOOTSTRAP_SECRET` can create the first platform owner only.
Once any owner exists it refuses, and every use is logged. Remove the secret
from Cloudflare once setup is done; the setup routes then answer 404.

Emails (reminders, announcements, invites) go through Resend. They need
`RESEND_API_KEY` and a verified sending domain. A failed send is reported in
the console, never shown as sent.
