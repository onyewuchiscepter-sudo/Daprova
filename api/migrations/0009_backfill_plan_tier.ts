import { Kysely, sql } from 'kysely';

// Bug fix: 0008_pricing renamed organisations.plan_tier -> current_plan_tier
// and set a new column default ('ENTRY') for future inserts, but never
// touched existing rows. Every pre-Sprint-4 org (Acme's dev seed, the system
// templates org) was left holding the old default value 'starter', which
// doesn't exist in plan_tiers — hasFeature()/assertFeature() throw a raw
// "Unknown plan tier" notFound for these orgs instead of a clean
// upgrade-required error. ENTRY is the correct equivalent of the old
// unpaid/default 'starter' state (lowest paid tier, no exportable_reports).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`UPDATE organisations SET current_plan_tier = 'ENTRY' WHERE current_plan_tier = 'starter'`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`UPDATE organisations SET current_plan_tier = 'starter' WHERE current_plan_tier = 'ENTRY'`.execute(db);
}
