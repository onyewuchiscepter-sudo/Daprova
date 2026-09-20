import { sql } from 'kysely';
import { db } from '../../db/index.js';
import { AppError, badRequest, forbidden, notFound } from '../../lib/errors.js';
import { writeAuditLog } from '../../lib/auditLog.js';
import { emailConfigured, escapeHtml, sendEmails } from '../../lib/messaging.js';
import { createInvoice, markOverdueInvoices, assertNotBlocked } from './invoices.js';
import {
  ENTERPRISE_THRESHOLD,
  FREE_TRIAL_LEARNERS,
  TIER_ORDER,
  determineTier,
  loadOrgBilling,
  orgTier,
  tierConfig,
  trailingStudents,
  type OrgBilling,
  type TierId,
  isTierLocked,
} from './plan.js';

// Pricing & Billing Spec §3-§4, §7 — when cohorts may be created, what is
// invoiced when, and how tiers move.

// A cohort with an end date that nobody finalises is finalised this many
// days after it (the post-assessment window).
export const AUTO_FINALIZE_AFTER_DAYS = 14;

function addMonths(d: Date, months: number) {
  const out = new Date(d);
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
}

async function openCohortCount(orgId: string) {
  const row = await db
    .selectFrom('cohorts')
    .innerJoin('courses', 'courses.id', 'cohorts.course_id')
    .select(({ fn }) => fn.countAll().as('n'))
    .where('courses.org_id', '=', orgId)
    .where('cohorts.deleted_at', 'is', null)
    // Every cohort not yet finalised is running, whatever its status says.
    .where('cohorts.finalized_at', 'is', null)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

function contactSales(message: string, details: Record<string, unknown>) {
  return new AppError(403, 'CONTACT_SALES', message, { code: 'CONTACT_SALES', ...details });
}

// §3/§7 — the hard gate in the cohort-creation flow.
export async function assertCanCreateCohort(orgId: string) {
  const org = await loadOrgBilling(orgId);
  if (org.billing_status === 'suspended') throw forbidden('This organisation is suspended.');
  if (org.billing_status === 'pending_manual_quote' && !org.is_enterprise_custom) {
    throw contactSales('Your programme size needs an Enterprise plan. Our team will be in touch to set it up — or contact sales now.', {});
  }

  // Enterprise is never self-serve: at 1,000+ learners a year (projected or
  // actual) new cohorts stop until sales has set up a custom plan.
  if (!org.is_enterprise_custom && !isTierLocked(org)) {
    const trailing = await trailingStudents(orgId);
    if (trailing >= ENTERPRISE_THRESHOLD || (org.projected_students_per_year ?? 0) >= ENTERPRISE_THRESHOLD) {
      throw contactSales(`You've reached ${Math.max(trailing, org.projected_students_per_year ?? 0).toLocaleString()} learners a year — programmes of 1,000+ are on our Enterprise plan. Contact sales to continue creating cohorts.`, {
        trailing_students: trailing,
        projected_students: org.projected_students_per_year,
      });
    }
  }

  await assertNotBlocked(orgId, 'start a new cohort');

  const tier = await orgTier(org);
  if (tier.concurrent_cohorts_limit !== null) {
    const open = await openCohortCount(orgId);
    if (open >= tier.concurrent_cohorts_limit) {
      throw new AppError(
        403,
        'COHORT_LIMIT',
        `The ${tier.display_name} plan runs ${tier.concurrent_cohorts_limit} cohort${tier.concurrent_cohorts_limit === 1 ? '' : 's'} at a time. Finalise a finished cohort first, or move up a plan.`,
        { code: 'COHORT_LIMIT', limit: tier.concurrent_cohorts_limit, open },
      );
    }
  }
}

// Billing begins when the free first cohort ends (it's finalised, or a second
// cohort is started). Monthly orgs get their first base-fee invoice then.
async function startBilling(org: OrgBilling) {
  if (org.billing_started_at) return;
  const now = new Date();
  const updated = await db
    .updateTable('organisations')
    .set({ billing_started_at: now, current_period_start: now })
    .where('id', '=', org.id)
    .where('billing_started_at', 'is', null)
    .returning('id')
    .executeTakeFirst();
  if (!updated) return; // someone else started it
  if (org.billing_frequency === 'monthly') await issueMonthlyInvoice({ ...org, billing_started_at: now, current_period_start: now }, now);
}

async function issueMonthlyInvoice(org: OrgBilling, periodStart: Date) {
  const tier = await orgTier(org);
  if (tier.base_fee_monthly_ngn === null) return; // Enterprise: invoiced by agreement
  const periodEnd = addMonths(periodStart, 1);
  try {
    await createInvoice({
      org,
      tier,
      kind: 'monthly_base',
      periodStart,
      periodEnd,
      lines: [{ category: 'base', description: `${tier.display_name} plan — monthly base fee`, quantity: 1, unit_ngn: tier.base_fee_monthly_ngn, amount_ngn: tier.base_fee_monthly_ngn }],
    });
  } catch (err) {
    if ((err as { code?: string }).code !== '23505') throw err; // already issued for this period
  }
}

// Called right after a cohort row is created. The org's first cohort is its
// free trial; otherwise billing is running, and per-cohort-cycle orgs pay the
// cycle base fee upfront.
export async function onCohortCreated(orgId: string, cohortId: string) {
  const free = await db.transaction().execute(async (trx) => {
    const org = await trx.selectFrom('organisations').select(['free_cohorts_remaining']).where('id', '=', orgId).forUpdate().executeTakeFirstOrThrow();
    if (org.free_cohorts_remaining <= 0) return false;
    await trx.updateTable('organisations').set({ free_cohorts_remaining: org.free_cohorts_remaining - 1 }).where('id', '=', orgId).execute();
    await trx.updateTable('cohorts').set({ is_free_trial: true }).where('id', '=', cohortId).execute();
    return true;
  });
  if (free) return { free_trial: true };

  const org = await loadOrgBilling(orgId);
  await startBilling(org);
  if (org.billing_frequency === 'per_cohort_cycle') {
    const tier = await orgTier(org);
    if (tier.base_fee_per_cohort_cycle_ngn !== null) {
      const now = new Date();
      await createInvoice({
        org,
        tier,
        kind: 'cohort_cycle_base',
        cohortId,
        periodStart: now,
        periodEnd: addMonths(now, 4),
        lines: [
          {
            category: 'base',
            description: `${tier.display_name} plan — cohort cycle base fee`,
            quantity: 1,
            unit_ngn: tier.base_fee_per_cohort_cycle_ngn,
            amount_ngn: tier.base_fee_per_cohort_cycle_ngn,
          },
        ],
      });
    }
  }
  return { free_trial: false };
}

// §3 — re-evaluate the tier from trailing volume at a cycle boundary.
// Upgrades take effect now (the start of the next cycle); downgrades only at
// a renewal point — for per-cohort-cycle orgs, not while a cohort billed at
// the higher tier is still running (§7 downgrade protection). Enterprise is
// never applied automatically: the cohort-creation gate routes to sales.
export async function evaluateTier(org: OrgBilling, opts: { renewal: boolean }) {
  const trailing = await trailingStudents(org.id);
  const target = determineTier(trailing);
  const current = org.pricing_tier as TierId;
  if (org.is_enterprise_custom || isTierLocked(org) || target === current) {
    if (org.pending_tier) await db.updateTable('organisations').set({ pending_tier: null }).where('id', '=', org.id).execute();
    return { changed: false, trailing, tier: current };
  }
  if (target === 'enterprise') {
    await db.updateTable('organisations').set({ pending_tier: 'enterprise' }).where('id', '=', org.id).execute();
    return { changed: false, trailing, tier: current, pending: 'enterprise' as TierId };
  }

  const isDowngrade = TIER_ORDER.indexOf(target) < TIER_ORDER.indexOf(current);
  let canApply = true;
  if (isDowngrade && !opts.renewal) canApply = false;
  if (isDowngrade && org.billing_frequency === 'per_cohort_cycle' && (await openCohortCount(org.id)) > 0) canApply = false;

  if (!canApply) {
    await db.updateTable('organisations').set({ pending_tier: target }).where('id', '=', org.id).execute();
    return { changed: false, trailing, tier: current, pending: target };
  }

  await db.updateTable('organisations').set({ pricing_tier: target, tier_effective_date: sql`now()`, pending_tier: null }).where('id', '=', org.id).execute();
  await writeAuditLog({ actorPersonId: null, actorContext: 'system', orgId: org.id, action: 'tier_changed', details: { from: current, to: target, trailing_students: trailing } });
  await notifyTierChange(org, current, target, trailing);
  return { changed: true, trailing, tier: target, from: current };
}

async function notifyTierChange(org: OrgBilling, from: TierId, to: TierId, trailing: number) {
  if (!emailConfigured()) return;
  const [fromTier, toTier] = await Promise.all([tierConfig(org.pricing_version, from), tierConfig(org.pricing_version, to)]);
  const up = TIER_ORDER.indexOf(to) > TIER_ORDER.indexOf(from);
  const text = `${org.name} assessed ${trailing.toLocaleString()} learners in the last 12 months, so your Daprova plan has moved from ${fromTier.display_name} to ${toTier.display_name}. ${
    up ? 'New features are unlocked now; the new base fee applies from this billing cycle.' : 'The lower base fee applies from this billing cycle.'
  } Nothing already invoiced changes.`;
  await sendEmails([
    { to: org.contact_email, subject: `Your Daprova plan is now ${toTier.display_name}`, text, html: `<p>${escapeHtml(text)}</p>` },
  ]).catch(() => undefined);
}

// Learners who completed both the pre- and post-assessment in a cohort.
export async function completedPairs(cohortId: string) {
  const row = await db
    .selectFrom('assessment_sessions as pre')
    .innerJoin('assessment_sessions as post', (j) =>
      j.onRef('post.learner_id', '=', 'pre.learner_id').on('post.session_type', '=', 'post').on('post.status', '=', 'completed'),
    )
    .select(({ fn }) => fn.countAll().as('n'))
    .where('pre.cohort_id', '=', cohortId)
    .where('pre.session_type', '=', 'pre')
    .where('pre.status', '=', 'completed')
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

// §4 — close a cohort's post-assessment window and invoice its assessment
// fees at the tier active *now* (§7 mid-cohort tier crossing). Idempotent.
export async function finalizeCohort(orgId: string, cohortId: string, actorPersonId: string | null) {
  const cohort = await db
    .selectFrom('cohorts')
    .innerJoin('courses', 'courses.id', 'cohorts.course_id')
    .select(['cohorts.id', 'cohorts.name', 'cohorts.finalized_at', 'cohorts.is_free_trial', 'cohorts.created_at'])
    .where('cohorts.id', '=', cohortId)
    .where('courses.org_id', '=', orgId)
    .where('cohorts.deleted_at', 'is', null)
    .executeTakeFirst();
  if (!cohort) throw notFound('Cohort not found');
  if (cohort.finalized_at) throw badRequest('This cohort has already been finalised.');

  const org = await loadOrgBilling(orgId);
  const tier = await orgTier(org);
  const pairs = await completedPairs(cohortId);
  const waived = cohort.is_free_trial ? Math.min(pairs, FREE_TRIAL_LEARNERS) : 0;
  const billable = pairs - waived;
  const fee = tier.assessment_fee_per_learner_ngn;

  const lines = [];
  if (billable > 0) lines.push({ category: 'assessment' as const, description: `Assessment & certification — ${cohort.name}`, quantity: billable, unit_ngn: fee, amount_ngn: billable * fee });
  if (waived > 0) lines.push({ category: 'credit' as const, description: `Free trial — first cohort, ${waived} learner${waived === 1 ? '' : 's'} included`, quantity: waived, unit_ngn: 0, amount_ngn: 0 });

  const now = new Date();
  const invoice = await createInvoice({
    org,
    tier,
    kind: 'cohort_completion',
    cohortId,
    periodStart: new Date(cohort.created_at as unknown as string),
    periodEnd: now,
    lines,
    notes: pairs === 0 ? 'No learners completed both assessments.' : undefined,
  });
  await db.updateTable('cohorts').set({ finalized_at: now, status: 'closed' }).where('id', '=', cohortId).execute();
  await writeAuditLog({ actorPersonId, actorContext: actorPersonId ? 'org_admin' : 'system', orgId, action: 'cohort_finalized', details: { cohort_id: cohortId, learners: pairs, waived, invoice_id: invoice.id } });

  if (cohort.is_free_trial) await startBilling(org);
  // Per-cohort-cycle orgs are re-evaluated at the end of each cohort cycle,
  // once this cohort no longer counts as running (so a downgrade can apply
  // to the next cycle's base fee).
  if (org.billing_frequency === 'per_cohort_cycle' && (org.billing_started_at || cohort.is_free_trial)) {
    await evaluateTier(await loadOrgBilling(orgId), { renewal: true });
  }
  return { invoice, learners_completed: pairs, learners_waived: waived, learners_billed: billable, fee_per_learner_ngn: fee };
}

// What finalising would charge right now — shown before the admin confirms.
export async function finalizePreview(orgId: string, cohortId: string) {
  const org = await loadOrgBilling(orgId);
  const tier = await orgTier(org);
  const cohort = await db
    .selectFrom('cohorts')
    .innerJoin('courses', 'courses.id', 'cohorts.course_id')
    .select(['cohorts.is_free_trial', 'cohorts.finalized_at'])
    .where('cohorts.id', '=', cohortId)
    .where('courses.org_id', '=', orgId)
    .executeTakeFirst();
  if (!cohort) throw notFound('Cohort not found');
  const pairs = await completedPairs(cohortId);
  const waived = cohort.is_free_trial ? Math.min(pairs, FREE_TRIAL_LEARNERS) : 0;
  return {
    finalized: !!cohort.finalized_at,
    learners_completed: pairs,
    learners_waived: waived,
    learners_billed: pairs - waived,
    fee_per_learner_ngn: tier.assessment_fee_per_learner_ngn,
    total_ngn: (pairs - waived) * tier.assessment_fee_per_learner_ngn,
    tier: tier.display_name,
  };
}

// Hourly job: overdue invoices, monthly cycle boundaries (tier re-evaluation
// + next base-fee invoice) and auto-finalising cohorts past their window.
export async function runBillingCycle() {
  const summary = { overdue_marked: 0, periods_rolled: 0, tier_changes: 0, cohorts_finalized: 0, errors: 0 };
  summary.overdue_marked = await markOverdueInvoices();

  const due = await db
    .selectFrom('organisations')
    .select('id')
    .where('billing_frequency', '=', 'monthly')
    .where('billing_status', '=', 'active')
    .where('billing_started_at', 'is not', null)
    .where('deleted_at', 'is', null)
    .where(sql<boolean>`current_period_start + interval '1 month' <= now()`)
    .execute();
  for (const { id } of due) {
    try {
      // Catch up month by month if the job was down for a while.
      for (let guard = 0; guard < 24; guard++) {
        const org = await loadOrgBilling(id);
        const start = new Date(org.current_period_start as unknown as string);
        const next = addMonths(start, 1);
        if (next > new Date()) break;
        const result = await evaluateTier(org, { renewal: true });
        if (result.changed) summary.tier_changes++;
        await db.updateTable('organisations').set({ current_period_start: next }).where('id', '=', id).execute();
        await issueMonthlyInvoice(await loadOrgBilling(id), next);
        summary.periods_rolled++;
      }
    } catch (err) {
      summary.errors++;
      console.error(`[billing] monthly roll for ${id} failed:`, (err as Error).message);
    }
  }

  const stale = await db
    .selectFrom('cohorts')
    .innerJoin('courses', 'courses.id', 'cohorts.course_id')
    .select(['cohorts.id', 'courses.org_id'])
    .where('cohorts.finalized_at', 'is', null)
    .where('cohorts.deleted_at', 'is', null)
    .where('cohorts.end_date', 'is not', null)
    .where(sql<boolean>`cohorts.end_date + make_interval(days => ${AUTO_FINALIZE_AFTER_DAYS}) < now()`)
    .execute();
  for (const c of stale) {
    try {
      await finalizeCohort(c.org_id, c.id, null);
      summary.cohorts_finalized++;
    } catch (err) {
      summary.errors++;
      console.error(`[billing] auto-finalise ${c.id} failed:`, (err as Error).message);
    }
  }
  return summary;
}
