import { Kysely } from 'kysely';

// Self-serve plans (docs/billing.md, "Choosing a plan"):
// - organisations.chosen_tier: the plan the org picked. It's a floor: volume
//   can still move them up at renewal, never below it.
// - organisations.pending_billing_frequency: a monthly ↔ per-cohort switch
//   that takes effect at the next renewal.
// - invoices.on_paid: what paying this invoice does (start a plan, open a
//   cohort). Such invoices are offers, not debts: they never go overdue or
//   block anything. on_paid_applied_at makes applying it run once.
// - cohorts.awaiting_payment: a per-cohort org's new cohort, closed to
//   learners until its cycle fee is paid.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('organisations')
    .addColumn('chosen_tier', 'varchar(20)')
    .addColumn('pending_billing_frequency', 'varchar(20)')
    .execute();
  await db.schema.alterTable('invoices').addColumn('on_paid', 'jsonb').addColumn('on_paid_applied_at', 'timestamptz').execute();
  await db.schema.alterTable('cohorts').addColumn('awaiting_payment', 'boolean', (c) => c.notNull().defaultTo(false)).execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('cohorts').dropColumn('awaiting_payment').execute();
  await db.schema.alterTable('invoices').dropColumn('on_paid_applied_at').dropColumn('on_paid').execute();
  await db.schema.alterTable('organisations').dropColumn('pending_billing_frequency').dropColumn('chosen_tier').execute();
}
