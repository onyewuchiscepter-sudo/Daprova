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
then follows volume again, unless the org is on a custom Enterprise agreement.

## Jobs

- Workers: the Cron Trigger `7 * * * *` runs `runBillingCycle()`. It marks overdue
  invoices, rolls monthly periods, re-evaluates tiers and auto-finalises cohorts.
  Node runs the same job hourly.
- Platform console → org → **Run billing job now** triggers it on demand.

## Platform console

For each org it shows the plan and volume, and lets you edit pricing (tier,
frequency, projected volume, custom Enterprise JSON). From there you can also
mark invoices paid or void them (e.g. bank transfers), grant a free cohort,
and correct the billing status.
