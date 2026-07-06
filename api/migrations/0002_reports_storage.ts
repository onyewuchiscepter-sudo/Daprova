import { Kysely, sql } from 'kysely';

// Switches cohort_reports from S3 key references (spec's B7.1 pipeline) to
// storing the generated files directly as bytea — reports here are a few
// hundred KB to a few MB, well within what Postgres handles fine, and this
// avoids standing up S3 (a new AWS account) for a capability this MVP
// doesn't need yet. Downloads are served through an authenticated API route
// instead of a pre-signed S3 URL.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('cohort_reports')
    .dropColumn('pdf_s3_key')
    .dropColumn('docx_s3_key')
    .execute();
  await db.schema
    .alterTable('cohort_reports')
    .addColumn('pdf_data', 'bytea')
    .addColumn('docx_data', 'bytea')
    .execute();
  // Synchronous generation (no queue) means a row is only ever inserted once
  // rendering has already succeeded — narrow the status enum to match.
  await sql`ALTER TABLE cohort_reports DROP CONSTRAINT IF EXISTS cohort_reports_status_check`.execute(db);
  await sql`ALTER TABLE cohort_reports ADD CONSTRAINT cohort_reports_status_check CHECK (status IN ('ready', 'failed'))`.execute(db);
  await db.schema.alterTable('cohort_reports').alterColumn('status', (ac) => ac.setDefault('ready')).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE cohort_reports DROP CONSTRAINT IF EXISTS cohort_reports_status_check`.execute(db);
  await db.schema.alterTable('cohort_reports').alterColumn('status', (ac) => ac.setDefault('queued')).execute();
  await db.schema.alterTable('cohort_reports').dropColumn('pdf_data').dropColumn('docx_data').execute();
  await db.schema
    .alterTable('cohort_reports')
    .addColumn('pdf_s3_key', 'text')
    .addColumn('docx_s3_key', 'text')
    .execute();
}
