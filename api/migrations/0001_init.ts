import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.execute(db);

  await db.schema
    .createTable('organisations')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('name', 'varchar(255)', (c) => c.notNull())
    .addColumn('slug', 'varchar(100)', (c) => c.notNull().unique())
    .addColumn('logo_url', 'text')
    .addColumn('plan_tier', 'varchar(50)', (c) => c.notNull().defaultTo('starter'))
    .addColumn('contact_email', 'varchar(255)', (c) => c.notNull())
    .addColumn('country', 'varchar(100)', (c) => c.defaultTo('Nigeria'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  await db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('org_id', 'uuid', (c) => c.notNull().references('organisations.id'))
    .addColumn('email', 'varchar(255)', (c) => c.notNull().unique())
    .addColumn('display_name', 'varchar(255)')
    .addColumn('role', 'varchar(50)', (c) => c.notNull().defaultTo('admin'))
    .addColumn('auth_provider', 'varchar(50)', (c) => c.notNull().defaultTo('firebase'))
    .addColumn('auth_uid', 'varchar(255)', (c) => c.notNull().unique())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('last_login_at', 'timestamptz')
    .addColumn('deleted_at', 'timestamptz')
    .addCheckConstraint('users_role_check', sql`role IN ('admin', 'viewer')`)
    .execute();

  // Not in the original spec's table list — added to support real refresh-token
  // rotation + revocation per the B5.1/B5.3 security requirements.
  await db.schema
    .createTable('refresh_tokens')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (c) => c.notNull().references('users.id'))
    .addColumn('jti', 'varchar(100)', (c) => c.notNull().unique())
    .addColumn('expires_at', 'timestamptz', (c) => c.notNull())
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  // Referenced by cohorts.course_id in the spec's B2 schema but never defined there.
  await db.schema
    .createTable('courses')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('org_id', 'uuid', (c) => c.notNull().references('organisations.id'))
    .addColumn('name', 'varchar(255)', (c) => c.notNull())
    .addColumn('category', 'varchar(100)', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  await db.schema
    .createTable('competency_frameworks')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('org_id', 'uuid', (c) => c.notNull().references('organisations.id'))
    .addColumn('name', 'varchar(255)', (c) => c.notNull())
    .addColumn('category', 'varchar(100)', (c) => c.notNull())
    .addColumn('version', 'integer', (c) => c.notNull().defaultTo(1))
    .addColumn('is_template', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('is_locked', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('created_by', 'uuid', (c) => c.references('users.id'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  await db.schema
    .createTable('competency_areas')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('framework_id', 'uuid', (c) => c.notNull().references('competency_frameworks.id'))
    .addColumn('name', 'varchar(255)', (c) => c.notNull())
    .addColumn('description', 'text')
    .addColumn('display_order', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('is_active', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('questions')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('area_id', 'uuid', (c) => c.notNull().references('competency_areas.id'))
    .addColumn('question_text', 'text', (c) => c.notNull())
    .addColumn('option_a', 'text', (c) => c.notNull())
    .addColumn('option_b', 'text', (c) => c.notNull())
    .addColumn('option_c', 'text', (c) => c.notNull())
    .addColumn('option_d', 'text', (c) => c.notNull())
    .addColumn('correct_option', 'char(1)', (c) => c.notNull())
    .addColumn('assessment_type', 'varchar(10)', (c) => c.notNull().defaultTo('both'))
    .addColumn('is_active', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('questions_correct_option_check', sql`correct_option IN ('a','b','c','d')`)
    .addCheckConstraint('questions_assessment_type_check', sql`assessment_type IN ('pre','post','both')`)
    .execute();

  await db.schema
    .createTable('cohorts')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('course_id', 'uuid', (c) => c.notNull().references('courses.id'))
    .addColumn('framework_id', 'uuid', (c) => c.notNull().references('competency_frameworks.id'))
    .addColumn('name', 'varchar(255)', (c) => c.notNull())
    .addColumn('start_date', 'date')
    .addColumn('end_date', 'date')
    .addColumn('graduation_date', 'date')
    .addColumn('status', 'varchar(50)', (c) => c.notNull().defaultTo('setup'))
    .addColumn('pre_link_token', 'varchar(100)', (c) => c.notNull().unique())
    .addColumn('post_link_token', 'varchar(100)', (c) => c.notNull().unique())
    .addColumn('pass_threshold', sql`numeric(5,2)`, (c) => c.notNull().defaultTo(60.0))
    .addColumn('created_by', 'uuid', (c) => c.references('users.id'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('deleted_at', 'timestamptz')
    .addCheckConstraint('cohorts_status_check', sql`status IN ('setup','active','graduated','closed')`)
    .execute();

  await db.schema
    .createTable('learners')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('cohort_id', 'uuid', (c) => c.notNull().references('cohorts.id'))
    .addColumn('learner_token', 'varchar(100)', (c) => c.notNull().unique())
    .addColumn('display_name', 'varchar(255)')
    .addColumn('enrolment_id', 'varchar(100)')
    .addColumn('gender', 'varchar(50)')
    .addColumn('age_group', 'varchar(50)')
    .addColumn('location_type', 'varchar(20)')
    .addColumn('disability', 'varchar(50)')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('assessment_sessions')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('learner_id', 'uuid', (c) => c.notNull().references('learners.id'))
    .addColumn('cohort_id', 'uuid', (c) => c.notNull().references('cohorts.id'))
    .addColumn('session_type', 'varchar(10)', (c) => c.notNull())
    .addColumn('status', 'varchar(20)', (c) => c.notNull().defaultTo('started'))
    .addColumn('started_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('completed_at', 'timestamptz')
    .addColumn('total_score', sql`numeric(5,2)`)
    .addColumn('duration_secs', 'integer')
    .addColumn('flag_reason', 'varchar(100)')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('assessment_sessions_type_check', sql`session_type IN ('pre','post')`)
    .execute();
  await db.schema
    .createIndex('assessment_sessions_learner_type_uidx')
    .on('assessment_sessions')
    .columns(['learner_id', 'session_type'])
    .unique()
    .execute();

  await db.schema
    .createTable('question_responses')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('session_id', 'uuid', (c) => c.notNull().references('assessment_sessions.id'))
    .addColumn('question_id', 'uuid', (c) => c.notNull().references('questions.id'))
    .addColumn('area_id', 'uuid', (c) => c.notNull().references('competency_areas.id'))
    .addColumn('selected_option', 'char(1)')
    .addColumn('is_correct', 'boolean', (c) => c.notNull())
    .addColumn('answered_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('question_responses_option_check', sql`selected_option IN ('a','b','c','d')`)
    .execute();
  await db.schema
    .createIndex('question_responses_session_question_uidx')
    .on('question_responses')
    .columns(['session_id', 'question_id'])
    .unique()
    .execute();

  await db.schema
    .createTable('confidence_ratings')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('session_id', 'uuid', (c) => c.notNull().references('assessment_sessions.id'))
    .addColumn('area_id', 'uuid', (c) => c.notNull().references('competency_areas.id'))
    .addColumn('rating', 'smallint', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('confidence_ratings_rating_check', sql`rating BETWEEN 1 AND 5`)
    .execute();

  await db.schema
    .createTable('satisfaction_responses')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('learner_id', 'uuid', (c) => c.notNull().references('learners.id'))
    .addColumn('cohort_id', 'uuid', (c) => c.notNull().references('cohorts.id'))
    .addColumn('instructor_rating', 'smallint')
    .addColumn('content_relevance', 'smallint')
    .addColumn('delivery_satisfaction', 'smallint')
    .addColumn('nps_score', 'smallint')
    .addColumn('open_positive', 'text')
    .addColumn('open_improve', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('tracer_responses')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('learner_id', 'uuid', (c) => c.notNull().references('learners.id'))
    .addColumn('cohort_id', 'uuid', (c) => c.notNull().references('cohorts.id'))
    .addColumn('survey_wave', 'smallint', (c) => c.notNull().defaultTo(1))
    .addColumn('employment_status', 'varchar(50)')
    .addColumn('skill_usage', 'varchar(50)')
    .addColumn('income_change', 'varchar(50)')
    .addColumn('training_contribution', 'smallint')
    .addColumn('open_challenge', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('cohort_reports')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('cohort_id', 'uuid', (c) => c.notNull().references('cohorts.id'))
    .addColumn('generated_by', 'uuid', (c) => c.references('users.id'))
    .addColumn('funder_template', 'varchar(100)', (c) => c.notNull())
    .addColumn('narrative_json', 'jsonb')
    .addColumn('pdf_s3_key', 'text')
    .addColumn('docx_s3_key', 'text')
    .addColumn('status', 'varchar(20)', (c) => c.notNull().defaultTo('queued'))
    .addColumn('generated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('cohort_reports').ifExists().execute();
  await db.schema.dropTable('tracer_responses').ifExists().execute();
  await db.schema.dropTable('satisfaction_responses').ifExists().execute();
  await db.schema.dropTable('confidence_ratings').ifExists().execute();
  await db.schema.dropTable('question_responses').ifExists().execute();
  await db.schema.dropTable('assessment_sessions').ifExists().execute();
  await db.schema.dropTable('learners').ifExists().execute();
  await db.schema.dropTable('cohorts').ifExists().execute();
  await db.schema.dropTable('questions').ifExists().execute();
  await db.schema.dropTable('competency_areas').ifExists().execute();
  await db.schema.dropTable('competency_frameworks').ifExists().execute();
  await db.schema.dropTable('courses').ifExists().execute();
  await db.schema.dropTable('refresh_tokens').ifExists().execute();
  await db.schema.dropTable('users').ifExists().execute();
  await db.schema.dropTable('organisations').ifExists().execute();
}
