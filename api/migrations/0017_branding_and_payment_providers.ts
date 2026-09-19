import { Kysely, sql } from 'kysely';

// Priority-1 work:
// - Custom branding (the GROWTH+ "custom_branding" tier feature): an org's
//   own logo and accent colour, applied to its reports, assessment pages
//   and certificates. The logo is stored in the database rather than object
//   storage — it's one small PNG/JPEG per org (capped at 300 KB by the API),
//   and keeping it next to the rest of the org row means the Worker needs
//   no extra storage credentials to serve or embed it.
// - Real payment providers (Paystack / Flutterwave): what the payment is
//   for, the provider-hosted checkout URL to resend on retry, and the
//   provider's own transaction id for support lookups.
// - The stub provider's state moves from an in-process Map into a table,
//   because on Workers the "simulate" request and the reconciliation cron
//   can run in different isolates and never see each other's memory.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('organisations')
    .addColumn('brand_color', 'varchar(7)')
    .addColumn('logo_data', 'bytea')
    .addColumn('logo_mime', 'varchar(20)')
    .addColumn('logo_updated_at', 'timestamptz')
    .execute();

  await db.schema
    .alterTable('payments')
    .addColumn('purpose', 'varchar(20)', (c) => c.notNull().defaultTo('capacity'))
    .addColumn('checkout_url', 'text')
    .addColumn('provider_transaction_id', 'varchar(100)')
    .addColumn('failure_reason', 'text')
    .execute();

  await db.schema
    .createTable('payment_stub_state')
    .addColumn('reference', 'varchar(100)', (c) => c.primaryKey())
    .addColumn('status', 'varchar(20)', (c) => c.notNull().defaultTo('pending'))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('payment_stub_state').execute();
  await db.schema
    .alterTable('payments')
    .dropColumn('purpose')
    .dropColumn('checkout_url')
    .dropColumn('provider_transaction_id')
    .dropColumn('failure_reason')
    .execute();
  await db.schema
    .alterTable('organisations')
    .dropColumn('brand_color')
    .dropColumn('logo_data')
    .dropColumn('logo_mime')
    .dropColumn('logo_updated_at')
    .execute();
}
