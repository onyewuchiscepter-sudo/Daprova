import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date | string, Date | string>;

export interface OrganisationsTable {
  id: Generated<string>;
  name: string;
  slug: string;
  logo_url: string | null;
  plan_tier: Generated<string>;
  contact_email: string;
  country: Generated<string>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface PeopleTable {
  id: Generated<string>;
  email: string;
  display_name: string | null;
  auth_provider: Generated<string>;
  auth_uid: string;
  created_at: Generated<Timestamp>;
  last_login_at: Timestamp | null;
  deleted_at: Timestamp | null;
}

export interface OrgMembershipsTable {
  id: Generated<string>;
  person_id: string;
  org_id: string;
  role: Generated<string>; // admin | viewer
  created_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface RefreshTokensTable {
  id: Generated<string>;
  person_id: string;
  org_id: string;
  jti: string;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
  replaced_by_jti: string | null;
  created_at: Generated<Timestamp>;
}

export interface CoursesTable {
  id: Generated<string>;
  org_id: string;
  name: string;
  category: string;
  created_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface CompetencyFrameworksTable {
  id: Generated<string>;
  org_id: string;
  name: string;
  category: string;
  version: Generated<number>;
  is_template: Generated<boolean>;
  is_locked: Generated<boolean>;
  created_by: string | null;
  created_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface CompetencyAreasTable {
  id: Generated<string>;
  framework_id: string;
  name: string;
  description: string | null;
  display_order: Generated<number>;
  is_active: Generated<boolean>;
  created_at: Generated<Timestamp>;
}

export interface QuestionsTable {
  id: Generated<string>;
  area_id: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: string;
  assessment_type: Generated<string>;
  is_active: Generated<boolean>;
  created_at: Generated<Timestamp>;
}

export interface CohortsTable {
  id: Generated<string>;
  course_id: string;
  framework_id: string;
  name: string;
  start_date: Timestamp | null;
  end_date: Timestamp | null;
  graduation_date: Timestamp | null;
  status: Generated<string>;
  pre_link_token: string;
  post_link_token: string;
  pass_threshold: Generated<number>;
  created_by: string | null;
  created_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface LearnersTable {
  id: Generated<string>;
  cohort_id: string;
  learner_token: string;
  display_name: string | null;
  enrolment_id: string | null;
  gender: string | null;
  age_group: string | null;
  location_type: string | null;
  disability: string | null;
  created_at: Generated<Timestamp>;
}

export interface AssessmentSessionsTable {
  id: Generated<string>;
  learner_id: string;
  cohort_id: string;
  session_type: string;
  status: Generated<string>;
  started_at: Generated<Timestamp>;
  completed_at: Timestamp | null;
  total_score: number | null;
  duration_secs: number | null;
  flag_reason: string | null;
  created_at: Generated<Timestamp>;
}

export interface QuestionResponsesTable {
  id: Generated<string>;
  session_id: string;
  question_id: string;
  area_id: string;
  selected_option: string | null;
  is_correct: boolean;
  answered_at: Generated<Timestamp>;
}

export interface ConfidenceRatingsTable {
  id: Generated<string>;
  session_id: string;
  area_id: string;
  rating: number;
  created_at: Generated<Timestamp>;
}

export interface SatisfactionResponsesTable {
  id: Generated<string>;
  learner_id: string;
  cohort_id: string;
  instructor_rating: number | null;
  content_relevance: number | null;
  delivery_satisfaction: number | null;
  nps_score: number | null;
  open_positive: string | null;
  open_improve: string | null;
  created_at: Generated<Timestamp>;
}

export interface TracerResponsesTable {
  id: Generated<string>;
  learner_id: string;
  cohort_id: string;
  survey_wave: Generated<number>;
  employment_status: string | null;
  skill_usage: string | null;
  income_change: string | null;
  training_contribution: number | null;
  open_challenge: string | null;
  created_at: Generated<Timestamp>;
}

export interface CohortReportsTable {
  id: Generated<string>;
  cohort_id: string;
  generated_by: string | null;
  funder_template: string;
  narrative_json: unknown | null;
  pdf_data: Buffer | null;
  docx_data: Buffer | null;
  status: Generated<string>;
  generated_at: Generated<Timestamp>;
}

export interface PlatformAdminsTable {
  id: Generated<string>;
  person_id: string;
  platform_role: string; // support | owner
  granted_at: Generated<Timestamp>;
  granted_by: string | null;
}

export interface AuditLogTable {
  id: Generated<string>;
  actor_person_id: string | null;
  actor_context: string; // org_admin | platform_admin | impersonating
  org_id: string | null;
  action: string;
  details: unknown | null;
  created_at: Generated<Timestamp>;
}

export interface Database {
  organisations: OrganisationsTable;
  people: PeopleTable;
  org_memberships: OrgMembershipsTable;
  platform_admins: PlatformAdminsTable;
  audit_log: AuditLogTable;
  refresh_tokens: RefreshTokensTable;
  courses: CoursesTable;
  competency_frameworks: CompetencyFrameworksTable;
  competency_areas: CompetencyAreasTable;
  questions: QuestionsTable;
  cohorts: CohortsTable;
  learners: LearnersTable;
  assessment_sessions: AssessmentSessionsTable;
  question_responses: QuestionResponsesTable;
  confidence_ratings: ConfidenceRatingsTable;
  satisfaction_responses: SatisfactionResponsesTable;
  tracer_responses: TracerResponsesTable;
  cohort_reports: CohortReportsTable;
}
