import { sql } from 'kysely';
import { db } from '../../db/index.js';
import { AppError, badRequest, notFound } from '../../lib/errors.js';
import { writeAuditLog } from '../../lib/auditLog.js';
import { createInvoice, type InvoiceLine } from './invoices.js';
import { TIER_ORDER, determineTier, isTierLocked, loadOrgBilling, orgTier, tierConfig, trailingStudents, type OrgBilling, type TierConfig, type TierId } from './plan.js';

// Self-serve plans (docs/billing.md, "Choosing a plan"). An org admin picks a
// plan and billing frequency on the Billing page. Anything that costs money
// now is an invoice carrying an on_paid action, applied only once it's paid;
// everything else applies at once or at the next renewal.

export type BillingFrequency = 'monthly' | 'per_cohort_cycle';
export const SELF_SERVE_TIERS: TierId[] = ['starter', 'growth', 'scale'];

// What paying an invoice does. Stored on invoices.on_paid.
export type InvoiceAction =
  // Start (or restart) a plan: ends the free trial, sets tier and frequency.
  // Monthly: the invoice is the first month's base fee, from the moment it's paid.
  | { type: 'start_plan'; tier: TierId; billing_frequency: BillingFrequency }
  // Move up a plan mid-cycle; the invoice is the pro-rated difference.
  | { type: 'upgrade_plan'; tier: TierId }
  // A per-cohort org's new cohort opens to learners once its cycle fee is paid.
  | { type: 'open_cohort'; cohort_id: string };

// Plan offers that weren't paid are dropped after this long.
const PLAN_OFFER_TTL_DAYS = 3;

function addMonths(d: Date, months: number) {
  const out = new Date(d);
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
}

function higher(a: TierId, b: TierId): TierId {
  return TIER_ORDER.indexOf(a) >= TIER_ORDER.indexOf(b) ? a : b;
}

// The plan volume would put the org on, raised to the plan it chose.
// Enterprise from volume is never lowered (it routes to sales).
export function floorTier(byVolume: TierId, chosen: string | null): TierId {
  if (byVolume === 'enterprise' || !chosen || !SELF_SERVE_TIERS.includes(chosen as TierId)) return byVolume;
  return higher(byVolume, chosen as TierId);
}

// Pro-rated base-fee difference for the rest of the current month. Shared
// with the platform console's "bill the difference" option.
export function proratedMonthlyDifference(org: Pick<OrgBilling, 'current_period_start'>, oldFee: number, newFee: number, now = new Date()) {
  const periodStart = org.current_period_start ? new Date(org.current_period_start as unknown as string) : null;
  if (!periodStart) return null;
  const periodEnd = addMonths(periodStart, 1);
  const fraction = Math.max(0, Math.min(1, (periodEnd.getTime() - now.getTime()) / (periodEnd.getTime() - periodStart.getTime())));
  const days = Math.ceil((periodEnd.getTime() - now.getTime()) / 86400000);
  return { amount: Math.round((newFee - oldFee) * fraction), days, periodEnd };
}

// Cohorts running on a paid cycle fee (not the free trial, not still waiting
// for payment, not finalised).
async function paidRunningCohorts(orgId: string) {
  const row = await db
    .selectFrom('cohorts')
    .innerJoin('courses', 'courses.id', 'cohorts.course_id')
    .select(({ fn }) => fn.countAll().as('n'))
    .where('courses.org_id', '=', orgId)
    .where('cohorts.deleted_at', 'is', null)
    .where('cohorts.finalized_at', 'is', null)
    .where('cohorts.is_free_trial', '=', false)
    .where('cohorts.awaiting_payment', '=', false)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

function naira(n: number) {
  return `₦${n.toLocaleString('en-NG')}`;
}

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

type Plan = {
  // What the admin is told before confirming.
  summary: string;
  // Charged now through checkout; 0 means nothing to pay.
  charge_ngn: number;
  lines: InvoiceLine[];
  action: InvoiceAction | null; // applied on payment (or at once when charge is 0)
  // Applied straight away, with or without a payment.
  immediate: { chosen_tier: TierId; pending_billing_frequency: BillingFrequency | null };
  invoice_tier: TierConfig;
  period_end: Date;
};

class PlanRefusal extends AppError {
  constructor(message: string, code = 'PLAN_CHANGE_NOT_ALLOWED') {
    super(400, code, message, { code });
  }
}

async function buildPlan(orgId: string, tierId: string, frequency: string): Promise<{ org: OrgBilling; current: TierConfig; plan: Plan }> {
  if (!SELF_SERVE_TIERS.includes(tierId as TierId)) throw badRequest('Choose Starter, Growth or Scale. Enterprise is arranged with our team.');
  if (frequency !== 'monthly' && frequency !== 'per_cohort_cycle') throw badRequest('Choose monthly or per-cohort billing.');
  const tier = tierId as TierId;
  const freq = frequency as BillingFrequency;

  const org = await loadOrgBilling(orgId);
  if (org.billing_status === 'suspended') throw new PlanRefusal('This organisation is suspended.');
  if (org.is_enterprise_custom || org.pricing_tier === 'enterprise') throw new PlanRefusal('Your plan is set by agreement with Daprova. Contact us to change it.', 'CONTACT_SALES');
  if (org.billing_status === 'pending_manual_quote') throw new PlanRefusal('Your programme size needs an Enterprise plan. Contact sales to continue.', 'CONTACT_SALES');
  if (isTierLocked(org)) throw new PlanRefusal('Daprova has set your plan for you. Contact us if you want to change it.');

  const trailing = await trailingStudents(orgId);
  const byVolume = determineTier(trailing);
  if (TIER_ORDER.indexOf(tier) < TIER_ORDER.indexOf(byVolume)) {
    const needed = await tierConfig(org.pricing_version, byVolume);
    throw new PlanRefusal(`You assessed ${trailing.toLocaleString()} learners in the last 12 months, which needs at least the ${needed.display_name} plan.`);
  }

  const current = await orgTier(org);
  const target = await tierConfig(org.pricing_version, tier);
  const now = new Date();
  const currentFreq = org.billing_frequency as BillingFrequency;
  const tierUp = TIER_ORDER.indexOf(tier) > TIER_ORDER.indexOf(current.tier_id);
  const tierDown = TIER_ORDER.indexOf(tier) < TIER_ORDER.indexOf(current.tier_id);
  const firstMonth = (): Plan => ({
    summary: '',
    charge_ngn: target.base_fee_monthly_ngn ?? 0,
    lines: [{ category: 'base', description: `${target.display_name} plan — monthly base fee`, quantity: 1, unit_ngn: target.base_fee_monthly_ngn ?? 0, amount_ngn: target.base_fee_monthly_ngn ?? 0 }],
    action: { type: 'start_plan', tier, billing_frequency: 'monthly' },
    immediate: { chosen_tier: tier, pending_billing_frequency: null },
    invoice_tier: target,
    period_end: addMonths(now, 1),
  });

  // Free trial: choosing a plan ends it. The trial cohort stays free.
  if (!org.billing_started_at) {
    const keep = ` Your free trial ends${freq === 'monthly' ? ' once you pay' : ' now'}. Your trial cohort stays free, including assessments for its first learners.`;
    if (freq === 'monthly') {
      const p = firstMonth();
      p.summary = `Pay ${naira(p.charge_ngn)} now for your first month on ${target.display_name}. The month starts when you pay, and the next invoice comes a month later.${keep}`;
      return { org, current, plan: p };
    }
    return {
      org,
      current,
      plan: {
        summary: `You'll be on ${target.display_name}, billed per cohort: each new cohort's ${naira(target.base_fee_per_cohort_cycle_ngn ?? 0)} fee is paid when you create it, before it opens to learners.${keep}`,
        charge_ngn: 0,
        lines: [],
        action: { type: 'start_plan', tier, billing_frequency: 'per_cohort_cycle' },
        immediate: { chosen_tier: tier, pending_billing_frequency: null },
        invoice_tier: target,
        period_end: now,
      },
    };
  }

  if (tier === current.tier_id && freq === currentFreq) {
    if (org.pending_billing_frequency || (org.chosen_tier && org.chosen_tier !== tier)) {
      return {
        org,
        current,
        plan: {
          summary: `You'll stay on ${target.display_name}, billed ${freq === 'monthly' ? 'monthly' : 'per cohort'}. Any change you scheduled earlier is cancelled.`,
          charge_ngn: 0,
          lines: [],
          action: null,
          immediate: { chosen_tier: tier, pending_billing_frequency: null },
          invoice_tier: target,
          period_end: now,
        },
      };
    }
    throw new PlanRefusal(`You're already on ${target.display_name}, billed ${freq === 'monthly' ? 'monthly' : 'per cohort'}.`);
  }

  const running = await paidRunningCohorts(orgId);

  // Per cohort → monthly with nothing running: start monthly billing now.
  if (currentFreq === 'per_cohort_cycle' && freq === 'monthly' && running === 0) {
    const p = firstMonth();
    p.summary = `Pay ${naira(p.charge_ngn)} now for your first month on ${target.display_name}. From then on you're billed monthly instead of per cohort.`;
    return { org, current, plan: p };
  }

  const parts: string[] = [];
  let charge = 0;
  let lines: InvoiceLine[] = [];
  let action: InvoiceAction | null = null;
  let periodEnd = now;

  if (tierUp) {
    if (currentFreq === 'monthly') {
      const diff = proratedMonthlyDifference(org, current.base_fee_monthly_ngn ?? 0, target.base_fee_monthly_ngn ?? 0, now);
      if (diff && diff.amount > 0) {
        charge = diff.amount;
        periodEnd = diff.periodEnd;
        lines = [{ category: 'base', description: `Plan change ${current.display_name} → ${target.display_name}: base-fee difference for the rest of this month (${diff.days} day${diff.days === 1 ? '' : 's'})`, quantity: 1, unit_ngn: diff.amount, amount_ngn: diff.amount }];
      }
    } else if (running > 0) {
      const per = (target.base_fee_per_cohort_cycle_ngn ?? 0) - (current.base_fee_per_cohort_cycle_ngn ?? 0);
      if (per > 0) {
        charge = per * running;
        periodEnd = addMonths(now, 4);
        lines = [{ category: 'base', description: `Plan change ${current.display_name} → ${target.display_name}: cycle-fee difference for ${running} running cohort${running === 1 ? '' : 's'}`, quantity: running, unit_ngn: per, amount_ngn: charge }];
      }
    }
    action = { type: 'upgrade_plan', tier };
    parts.push(
      charge > 0
        ? `Pay ${naira(charge)} now (the difference for ${currentFreq === 'monthly' ? 'the rest of this month' : 'your running cohorts'}) and ${target.display_name} starts straight away.`
        : `${target.display_name} starts straight away.`,
    );
  } else if (tierDown) {
    parts.push(
      currentFreq === 'monthly'
        ? `You'll move to ${target.display_name} at your next renewal${org.current_period_start ? ` (${fmtDate(addMonths(new Date(org.current_period_start as unknown as string), 1))})` : ''}, if your learner numbers allow it. You keep ${current.display_name} until then.`
        : `You'll move to ${target.display_name} once no paid cohort is running, if your learner numbers allow it. You keep ${current.display_name} until then.`,
    );
  }

  let pendingFreq: BillingFrequency | null = null;
  if (freq !== currentFreq) {
    pendingFreq = freq;
    parts.push(
      freq === 'per_cohort_cycle'
        ? `From your next renewal${org.current_period_start ? ` (${fmtDate(addMonths(new Date(org.current_period_start as unknown as string), 1))})` : ''} you'll pay per cohort instead of monthly.`
        : `You'll switch to monthly billing once your running cohort${running === 1 ? '' : 's'} ${running === 1 ? 'is' : 'are'} finalised.`,
    );
  }

  return {
    org,
    current,
    plan: { summary: parts.join(' '), charge_ngn: charge, lines, action, immediate: { chosen_tier: tier, pending_billing_frequency: pendingFreq }, invoice_tier: target, period_end: periodEnd },
  };
}

export async function quotePlanChange(orgId: string, tier: string, frequency: string) {
  const { plan } = await buildPlan(orgId, tier, frequency);
  return { summary: plan.summary, charge_ngn: plan.charge_ngn, lines: plan.lines };
}

// Earlier plan offers the admin didn't pay are replaced by a new one.
async function voidPlanOffers(orgId: string, reason: string) {
  const offers = await db
    .selectFrom('invoices')
    .select('id')
    .where('org_id', '=', orgId)
    .where('status', 'in', ['pending', 'overdue'])
    .where('deleted_at', 'is', null)
    .where(sql<boolean>`on_paid->>'type' in ('start_plan', 'upgrade_plan')`)
    .execute();
  if (!offers.length) return;
  const ids = offers.map((o) => o.id);
  await db.updateTable('payments').set({ status: 'abandoned', failure_reason: reason }).where('invoice_id', 'in', ids).where('status', '=', 'pending').execute();
  await db.updateTable('invoices').set({ status: 'void', notes: reason }).where('id', 'in', ids).where('status', 'in', ['pending', 'overdue']).execute();
}

// Returns { invoice } when something must be paid first (the caller opens the
// checkout), otherwise applies the change and returns { applied: true }.
export async function changePlan(orgId: string, actorPersonId: string, tier: string, frequency: string) {
  const { org, plan } = await buildPlan(orgId, tier, frequency);
  await voidPlanOffers(orgId, 'Replaced by a newer plan choice');

  await db
    .updateTable('organisations')
    .set({ chosen_tier: plan.immediate.chosen_tier, pending_billing_frequency: plan.immediate.pending_billing_frequency })
    .where('id', '=', orgId)
    .execute();
  await writeAuditLog({
    actorPersonId,
    actorContext: 'org_admin',
    orgId,
    action: 'plan_chosen',
    details: { tier, billing_frequency: frequency, charge_ngn: plan.charge_ngn, from: { tier: org.pricing_tier, billing_frequency: org.billing_frequency } },
  });

  if (plan.charge_ngn > 0 && plan.action) {
    const invoice = await createInvoice({
      org,
      tier: plan.invoice_tier,
      kind: plan.action.type === 'start_plan' ? 'monthly_base' : 'plan_change',
      periodStart: new Date(),
      periodEnd: plan.period_end,
      lines: plan.lines,
      onPaid: plan.action,
    });
    // Account credit can cover it entirely, in which case it's already paid.
    if (invoice.status === 'paid') {
      await applyPaidInvoice(invoice.id);
      return { applied: true as const, summary: plan.summary };
    }
    return { applied: false as const, invoice, summary: plan.summary };
  }
  if (plan.action) await applyAction(orgId, plan.action, null);
  return { applied: true as const, summary: plan.summary };
}

async function applyAction(orgId: string, action: InvoiceAction, invoiceId: string | null) {
  const org = await loadOrgBilling(orgId);
  if (action.type === 'start_plan') {
    const now = new Date();
    await db
      .updateTable('organisations')
      .set({
        ...(org.pricing_tier !== action.tier ? { pricing_tier: action.tier, tier_effective_date: sql`now()` } : {}),
        chosen_tier: action.tier,
        pending_tier: null,
        billing_frequency: action.billing_frequency,
        pending_billing_frequency: null,
        free_cohorts_remaining: 0,
        billing_started_at: org.billing_started_at ?? now,
        // Monthly: the paid invoice is this month's, so the next one is due
        // a month from now (runBillingCycle rolls from current_period_start).
        current_period_start: action.billing_frequency === 'monthly' ? now : org.current_period_start,
      })
      .where('id', '=', orgId)
      .execute();
  } else if (action.type === 'upgrade_plan') {
    // Volume may have moved them past this already; never move down here.
    if (TIER_ORDER.indexOf(action.tier) > TIER_ORDER.indexOf(org.pricing_tier as TierId)) {
      await db.updateTable('organisations').set({ pricing_tier: action.tier, tier_effective_date: sql`now()`, pending_tier: null }).where('id', '=', orgId).execute();
    }
  } else if (action.type === 'open_cohort') {
    await db.updateTable('cohorts').set({ awaiting_payment: false }).where('id', '=', action.cohort_id).execute();
  }
  await writeAuditLog({ actorPersonId: null, actorContext: 'system', orgId, action: 'invoice_action_applied', details: { ...action, invoice_id: invoiceId } });
}

// Runs an invoice's on_paid action once it's paid. Safe to call more than
// once and from anywhere an invoice becomes paid (gateway confirmation, the
// console's "mark paid", a discount to ₦0); the reconciliation job calls it
// for any that were missed.
export async function applyPaidInvoice(invoiceId: string) {
  const claimed = await db
    .updateTable('invoices')
    .set({ on_paid_applied_at: sql`now()` })
    .where('id', '=', invoiceId)
    .where('status', '=', 'paid')
    .where('on_paid', 'is not', null)
    .where('on_paid_applied_at', 'is', null)
    .returning(['id', 'org_id', 'on_paid'])
    .executeTakeFirst();
  if (!claimed) return false;
  const action = (typeof claimed.on_paid === 'string' ? JSON.parse(claimed.on_paid) : claimed.on_paid) as InvoiceAction;
  try {
    await applyAction(claimed.org_id, action, claimed.id);
  } catch (err) {
    // Release the claim so the next reconciliation run retries it.
    await db.updateTable('invoices').set({ on_paid_applied_at: null }).where('id', '=', invoiceId).execute();
    throw err;
  }
  return true;
}

export async function applyMissedInvoiceActions() {
  const rows = await db
    .selectFrom('invoices')
    .select('id')
    .where('status', '=', 'paid')
    .where('on_paid', 'is not', null)
    .where('on_paid_applied_at', 'is', null)
    .execute();
  let applied = 0;
  for (const r of rows) {
    try {
      if (await applyPaidInvoice(r.id)) applied++;
    } catch (err) {
      console.error(`[billing] applying invoice ${r.id} failed:`, (err as Error).message);
    }
  }
  return applied;
}

// Hourly: plan offers nobody paid within a few days are withdrawn.
export async function expireStalePlanOffers() {
  const rows = await db
    .updateTable('invoices')
    .set({ status: 'void', notes: 'Plan change not paid; withdrawn' })
    .where('status', 'in', ['pending', 'overdue'])
    .where('deleted_at', 'is', null)
    .where(sql<boolean>`on_paid->>'type' in ('start_plan', 'upgrade_plan')`)
    .where(sql<boolean>`created_at < now() - make_interval(days => ${PLAN_OFFER_TTL_DAYS})`)
    .returning('id')
    .execute();
  if (rows.length) {
    await db
      .updateTable('payments')
      .set({ status: 'abandoned', failure_reason: 'Plan change withdrawn' })
      .where('invoice_id', 'in', rows.map((r) => r.id))
      .where('status', '=', 'pending')
      .execute();
  }
  return rows.length;
}

// A per-cohort org's cohort that hasn't been paid for can be withdrawn, as
// long as no learner has started it.
export async function cancelUnpaidCohort(orgId: string, cohortId: string, actorPersonId: string) {
  const cohort = await db
    .selectFrom('cohorts')
    .innerJoin('courses', 'courses.id', 'cohorts.course_id')
    .select(['cohorts.id', 'cohorts.name', 'cohorts.awaiting_payment'])
    .where('cohorts.id', '=', cohortId)
    .where('courses.org_id', '=', orgId)
    .where('cohorts.deleted_at', 'is', null)
    .executeTakeFirst();
  if (!cohort) throw notFound('Cohort not found');
  if (!cohort.awaiting_payment) throw badRequest('Only a cohort that is still waiting for payment can be cancelled.');

  const invoices = await db
    .selectFrom('invoices')
    .select('id')
    .where('cohort_id', '=', cohortId)
    .where('status', 'in', ['pending', 'overdue'])
    .where(sql<boolean>`on_paid->>'type' = 'open_cohort'`)
    .execute();
  const ids = invoices.map((i) => i.id);
  if (ids.length) {
    await db.updateTable('payments').set({ status: 'abandoned', failure_reason: 'Cohort cancelled' }).where('invoice_id', 'in', ids).where('status', '=', 'pending').execute();
    await db.updateTable('invoices').set({ status: 'void', notes: 'Cohort cancelled before payment' }).where('id', 'in', ids).execute();
  }
  await db.updateTable('cohorts').set({ deleted_at: sql`now()` }).where('id', '=', cohortId).execute();
  await writeAuditLog({ actorPersonId, actorContext: 'org_admin', orgId, action: 'cohort_cancelled_unpaid', details: { cohort_id: cohortId, name: cohort.name } });
  return { cancelled: true };
}

// The open invoice that opens this cohort, for the cohort page's Pay button.
export async function cohortPaymentInvoice(cohortId: string) {
  return db
    .selectFrom('invoices')
    .select(['id', 'invoice_number', 'total_ngn'])
    .where('cohort_id', '=', cohortId)
    .where('status', 'in', ['pending', 'overdue'])
    .where('deleted_at', 'is', null)
    .where(sql<boolean>`on_paid->>'type' = 'open_cohort'`)
    .executeTakeFirst();
}
