import { Kysely, sql } from 'kysely';

// Platform operations: account credit and invoice discounts (applied by
// Daprova staff), and announcements shown to organisations in the app.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('organisations')
    // Goodwill/prepaid credit, applied automatically to the next invoices.
    .addColumn('credit_ngn', sql`numeric(12,2)`, (c) => c.notNull().defaultTo(0))
    .execute();
  await sql`ALTER TABLE organisations ADD CONSTRAINT organisations_credit_nonnegative CHECK (credit_ngn >= 0)`.execute(db);

  await db.schema
    .alterTable('invoices')
    // Total taken off an issued invoice by staff; total_ngn is already net of it.
    .addColumn('discount_ngn', sql`numeric(12,2)`, (c) => c.notNull().defaultTo(0))
    .execute();

  await db.schema
    .createTable('announcements')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('title', 'varchar(160)', (c) => c.notNull())
    .addColumn('body', 'text', (c) => c.notNull())
    .addColumn('level', 'varchar(10)', (c) => c.notNull().defaultTo('info')) // info | warning
    .addColumn('audience', 'varchar(10)', (c) => c.notNull().defaultTo('all')) // all | tier | org
    .addColumn('audience_tier', 'varchar(20)')
    .addColumn('audience_org_id', 'uuid', (c) => c.references('organisations.id'))
    .addColumn('starts_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('ends_at', 'timestamptz')
    .addColumn('emailed_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('created_by', 'uuid', (c) => c.references('people.id'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('deleted_at', 'timestamptz')
    .execute();
  await sql`ALTER TABLE announcements ADD CONSTRAINT announcements_level_check CHECK (level IN ('info','warning'))`.execute(db);
  await sql`ALTER TABLE announcements ADD CONSTRAINT announcements_audience_check CHECK (audience IN ('all','tier','org'))`.execute(db);

  await db.schema.createIndex('audit_log_created_idx').ifNotExists().on('audit_log').column('created_at').execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('audit_log_created_idx').ifExists().execute();
  await db.schema.dropTable('announcements').execute();
  await db.schema.alterTable('invoices').dropColumn('discount_ngn').execute();
  await sql`ALTER TABLE organisations DROP CONSTRAINT organisations_credit_nonnegative`.execute(db);
  await db.schema.alterTable('organisations').dropColumn('credit_ngn').execute();
}
