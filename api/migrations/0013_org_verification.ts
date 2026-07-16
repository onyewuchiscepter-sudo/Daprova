import { Kysely, sql } from 'kysely';

// Org verification — deliberately a separate axis from billing_status
// (active/locked_pending_upgrade/pending_manual_quote/suspended): a org can
// be fully paid-up and still be an unverified self-serve signup, and
// verifying an org says nothing about whether their bill is current.
//
// Existing orgs and every Model B (team-provisioned) org default to
// 'verified' — verification exists to gate self-serve (Model A) signups
// specifically, not to retroactively lock out orgs your own team already
// vetted by creating them directly.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('organisations')
    .addColumn('verification_status', 'varchar(20)', (c) => c.notNull().defaultTo('verified'))
    .execute();

  await sql`ALTER TABLE organisations ADD CONSTRAINT organisations_verification_status_check CHECK (verification_status IN ('pending','verified','banned'))`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE organisations DROP CONSTRAINT IF EXISTS organisations_verification_status_check`.execute(db);
  await db.schema.alterTable('organisations').dropColumn('verification_status').execute();
}
