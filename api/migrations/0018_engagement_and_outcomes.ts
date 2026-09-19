import { Kysely, sql } from 'kysely';

// Priority-2 work, one migration:
// - Learner contact details (optional, with consent) so an org can remind
//   learners who haven't done their post-assessment, plus a log of every
//   reminder (also used to stop the same learner being messaged twice a day).
// - Certificates: a stable, shareable verification code per learner,
//   assigned the first time a certificate is issued.
// - Funder share links: read-only public links to a cohort's aggregate
//   results, revocable, with a view count.
// - Tracer survey: a fourth learner link (like the satisfaction one) that
//   asks about outcomes 3-6 months later.
// - Question types beyond four-option multiple choice: true/false and
//   scenario questions are still scored; self-ratings are recorded but
//   excluded from scores (question_responses.is_scored).
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('learners')
    .addColumn('email', 'varchar(255)')
    .addColumn('phone', 'varchar(30)')
    .addColumn('contact_consent', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('certificate_code', 'varchar(20)', (c) => c.unique())
    .execute();

  await db.schema
    .createTable('learner_reminders')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('cohort_id', 'uuid', (c) => c.notNull().references('cohorts.id'))
    .addColumn('learner_id', 'uuid', (c) => c.notNull().references('learners.id'))
    .addColumn('kind', 'varchar(20)', (c) => c.notNull()) // post | satisfaction | tracer
    .addColumn('channel', 'varchar(20)', (c) => c.notNull()) // email | sms | whatsapp
    .addColumn('status', 'varchar(20)', (c) => c.notNull()) // sent | failed
    .addColumn('error', 'text')
    .addColumn('sent_by', 'uuid', (c) => c.references('people.id'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('learner_reminders_learner_idx').on('learner_reminders').columns(['learner_id', 'kind', 'created_at']).execute();

  await db.schema
    .createTable('cohort_share_links')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('cohort_id', 'uuid', (c) => c.notNull().references('cohorts.id'))
    .addColumn('token', 'varchar(64)', (c) => c.notNull().unique())
    .addColumn('label', 'varchar(120)')
    .addColumn('created_by', 'uuid', (c) => c.references('people.id'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('view_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('last_viewed_at', 'timestamptz')
    .execute();

  await db.schema
    .alterTable('cohorts')
    .addColumn('tracer_link_token', 'varchar(100)', (c) => c.notNull().unique().defaultTo(sql`gen_random_uuid()::text`))
    .execute();

  // tracer_responses has existed unused since 0001 (employment_status,
  // skill_usage, income_change, training_contribution 1-5, open_challenge,
  // survey_wave); this adds what the survey also asks and one answer per
  // learner per wave.
  await db.schema
    .alterTable('tracer_responses')
    .addColumn('business_status', 'varchar(40)')
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema
    .alterTable('tracer_responses')
    .addUniqueConstraint('tracer_responses_learner_wave_unique', ['learner_id', 'cohort_id', 'survey_wave'])
    .execute();

  await db.schema
    .alterTable('questions')
    .addColumn('question_type', 'varchar(20)', (c) => c.notNull().defaultTo('mcq')) // mcq | true_false | scenario | self_rating
    .addColumn('scenario_text', 'text')
    .execute();
  await db.schema.alterTable('questions').alterColumn('option_c', (c) => c.dropNotNull()).execute();
  await db.schema.alterTable('questions').alterColumn('option_d', (c) => c.dropNotNull()).execute();
  await db.schema.alterTable('questions').alterColumn('correct_option', (c) => c.dropNotNull()).execute();

  await sql`ALTER TABLE questions ADD CONSTRAINT questions_question_type_check CHECK (question_type IN ('mcq','true_false','scenario','self_rating'))`.execute(db);

  await db.schema
    .alterTable('question_responses')
    .addColumn('is_scored', 'boolean', (c) => c.notNull().defaultTo(true))
    .execute();
  // Self-ratings answer "1"-"5"; 0001 only allowed a-d.
  await sql`ALTER TABLE question_responses DROP CONSTRAINT IF EXISTS question_responses_option_check`.execute(db);
  await sql`ALTER TABLE question_responses ADD CONSTRAINT question_responses_option_check CHECK (selected_option IN ('a','b','c','d','1','2','3','4','5'))`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.deleteFrom('question_responses').where('selected_option', 'in', ['1', '2', '3', '4', '5']).execute();
  await sql`ALTER TABLE question_responses DROP CONSTRAINT IF EXISTS question_responses_option_check`.execute(db);
  await sql`ALTER TABLE question_responses ADD CONSTRAINT question_responses_option_check CHECK (selected_option IN ('a','b','c','d'))`.execute(db);
  await db.schema.alterTable('question_responses').dropColumn('is_scored').execute();
  await sql`ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_question_type_check`.execute(db);
  await db.deleteFrom('questions').where('question_type', '!=', 'mcq').execute();
  await db.schema.alterTable('questions').alterColumn('correct_option', (c) => c.setNotNull()).execute();
  await db.schema.alterTable('questions').alterColumn('option_d', (c) => c.setNotNull()).execute();
  await db.schema.alterTable('questions').alterColumn('option_c', (c) => c.setNotNull()).execute();
  await db.schema.alterTable('questions').dropColumn('question_type').dropColumn('scenario_text').execute();
  await db.schema.alterTable('tracer_responses').dropConstraint('tracer_responses_learner_wave_unique').execute();
  await db.schema.alterTable('tracer_responses').dropColumn('business_status').dropColumn('updated_at').execute();
  await db.schema.alterTable('cohorts').dropColumn('tracer_link_token').execute();
  await db.schema.dropTable('cohort_share_links').execute();
  await db.schema.dropTable('learner_reminders').execute();
  await db.schema.alterTable('learners').dropColumn('email').dropColumn('phone').dropColumn('contact_consent').dropColumn('certificate_code').execute();
}
