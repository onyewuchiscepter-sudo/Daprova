import { sql } from 'kysely';
import { db } from '../../db/index.js';
import { AppError, notFound } from '../../lib/errors.js';
import type { OrgBilling, TierConfig } from './plan.js';

// §6 invoices. Every charge (monthly base fee, per-cohort-cycle base fee,
// assessment fees at cohort completion, extra funder reports) is one invoice
// with itemised lines. Amounts are snapshotted at creation, so later tier or
// price changes never alter an issued invoice.

export const PAYMENT_TERMS_DAYS = 7;
// Unpaid this many days past the due date: new cohorts and new reports are
// blocked until it's paid. Existing cohorts and learners are never affected.
export const BLOCK_AFTER_OVERDUE_DAYS = 14;

export type InvoiceKind = 'monthly_base' | 'cohort_cycle_base' | 'cohort_completion' | 'report_overage';
export type InvoiceLine = { category: 'base' | 'assessment' | 'report' | 'credit'; description: string; quantity: number; unit_ngn: number; amount_ngn: number };

export async function createInvoice(opts: {
  org: OrgBilling;
  tier: TierConfig;
  kind: InvoiceKind;
  cohortId?: string | null;
  periodStart: Date;
  periodEnd: Date;
  lines: InvoiceLine[];
  notes?: string;
}) {
  const sum = (c: InvoiceLine['category']) => opts.lines.filter((l) => l.category === c).reduce((a, l) => a + l.amount_ngn, 0);
  const total = opts.lines.reduce((a, l) => a + l.amount_ngn, 0);
  const { rows } = await sql<{ n: string }>`select nextval('invoice_number_seq') as n`.execute(db);
  const year = new Date().getUTCFullYear();
  const due = new Date(Date.now() + PAYMENT_TERMS_DAYS * 86400000);

  return db
    .insertInto('invoices')
    .values({
      invoice_number: `DPV-${year}-${rows[0].n}`,
      org_id: opts.org.id,
      cohort_id: opts.cohortId ?? null,
      kind: opts.kind,
      tier_id: opts.tier.tier_id,
      pricing_version: opts.org.pricing_version,
      billing_period_start: opts.periodStart,
      billing_period_end: opts.periodEnd,
      base_fee_ngn: String(sum('base')),
      assessment_fee_ngn: String(sum('assessment')),
      report_fee_ngn: String(sum('report')),
      learners_billed_count: opts.lines.filter((l) => l.category === 'assessment').reduce((a, l) => a + l.quantity, 0),
      reports_billed_count: opts.lines.filter((l) => l.category === 'report').reduce((a, l) => a + l.quantity, 0),
      total_ngn: String(total),
      line_items: JSON.stringify(opts.lines),
      // Nothing to pay (e.g. a fully waived free-trial cohort): recorded for
      // the history, settled on creation.
      status: total > 0 ? 'pending' : 'paid',
      paid_at: total > 0 ? null : new Date(),
      due_date: due,
      notes: opts.notes ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

const INVOICE_COLUMNS = [
  'id',
  'invoice_number',
  'cohort_id',
  'kind',
  'tier_id',
  'pricing_version',
  'billing_period_start',
  'billing_period_end',
  'base_fee_ngn',
  'assessment_fee_ngn',
  'report_fee_ngn',
  'learners_billed_count',
  'reports_billed_count',
  'total_ngn',
  'line_items',
  'status',
  'due_date',
  'paid_at',
  'notes',
  'created_at',
] as const;

export async function listInvoices(orgId: string) {
  return db
    .selectFrom('invoices')
    .leftJoin('cohorts', 'cohorts.id', 'invoices.cohort_id')
    .select(INVOICE_COLUMNS.map((c) => `invoices.${c}` as const))
    .select('cohorts.name as cohort_name')
    .where('invoices.org_id', '=', orgId)
    .where('invoices.deleted_at', 'is', null)
    .orderBy('invoices.created_at', 'desc')
    .execute();
}

export async function getInvoice(orgId: string, invoiceId: string) {
  const invoice = await db.selectFrom('invoices').selectAll().where('id', '=', invoiceId).where('org_id', '=', orgId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!invoice) throw notFound('Invoice not found');
  return invoice;
}

export async function markInvoicePaid(invoiceId: string, note?: string) {
  return db
    .updateTable('invoices')
    .set({ status: 'paid', paid_at: sql`now()`, ...(note ? { notes: note } : {}) })
    .where('id', '=', invoiceId)
    .where('status', 'in', ['pending', 'overdue'])
    .returningAll()
    .executeTakeFirst();
}

export async function markOverdueInvoices() {
  const rows = await db
    .updateTable('invoices')
    .set({ status: 'overdue' })
    .where('status', '=', 'pending')
    .where('due_date', '<', sql<Date>`now()`)
    .where('deleted_at', 'is', null)
    .returning('id')
    .execute();
  return rows.length;
}

export async function blockingInvoice(orgId: string) {
  return db
    .selectFrom('invoices')
    .select(['id', 'invoice_number', 'total_ngn', 'due_date'])
    .where('org_id', '=', orgId)
    .where('status', 'in', ['pending', 'overdue'])
    .where('deleted_at', 'is', null)
    .where('due_date', '<', sql<Date>`now() - make_interval(days => ${BLOCK_AFTER_OVERDUE_DAYS})`)
    .orderBy('due_date')
    .executeTakeFirst();
}

export async function assertNotBlocked(orgId: string, action: string) {
  const invoice = await blockingInvoice(orgId);
  if (invoice) {
    throw new AppError(403, 'BILLING_OVERDUE', `Invoice ${invoice.invoice_number} is more than ${BLOCK_AFTER_OVERDUE_DAYS} days overdue — pay it on the Billing page to ${action}.`, {
      code: 'BILLING_OVERDUE',
      invoice_id: invoice.id,
    });
  }
}
