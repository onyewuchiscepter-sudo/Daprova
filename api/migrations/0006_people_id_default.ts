import { Kysely, sql } from 'kysely';

// Bug found while testing Sprint 2: 0003_people_org_memberships.ts created
// `people.id` without a default, because that migration's own data-copy
// step explicitly supplied `id` for every existing row (reusing each
// person's old users.id). It missed that every *new* person going forward
// (bootstrap.ts, platformService.ts, and any future invite/signup code)
// needs one, same as every other table's PK in this schema.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE people ALTER COLUMN id SET DEFAULT gen_random_uuid()`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE people ALTER COLUMN id DROP DEFAULT`.execute(db);
}
