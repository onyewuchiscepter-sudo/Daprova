import { Kysely, sql } from 'kysely';

// Learner satisfaction survey (S11) — originally appended to the
// post-assessment flow and gated on that session being completed, per user
// feedback that was too restrictive: an org may want to send the survey on
// its own schedule (e.g. a week after graduation), independent of whether
// any individual learner has finished post-assessment yet. It now gets its
// own shareable link, generated the same way as pre_link_token/post_link_token.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('cohorts')
    .addColumn('satisfaction_link_token', 'varchar(100)', (c) => c.notNull().unique().defaultTo(sql`gen_random_uuid()::text`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('cohorts').dropColumn('satisfaction_link_token').execute();
}
