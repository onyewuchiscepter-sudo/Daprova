export type Role = 'admin' | 'viewer';

export type ApiError = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type SessionClaims = {
  sub: string; // users.id
  org_id: string;
  role: Role;
};

export type CompetencyCategory =
  | 'digital_skills'
  | 'financial_literacy'
  | 'coding'
  | 'vocational'
  | 'agricultural'
  | 'creator_economy';

export type CompetencyFramework = {
  id: string;
  org_id: string;
  name: string;
  category: CompetencyCategory;
  version: number;
  is_template: boolean;
  is_locked: boolean;
  created_at: string;
};

export type CompetencyArea = {
  id: string;
  framework_id: string;
  name: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
};

export type Question = {
  id: string;
  area_id: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: 'a' | 'b' | 'c' | 'd';
  assessment_type: 'pre' | 'post' | 'both';
  is_active: boolean;
};

export type Course = {
  id: string;
  org_id: string;
  name: string;
  category: CompetencyCategory;
  created_at: string;
};

export type CohortStatus = 'setup' | 'active' | 'graduated' | 'closed';

export type Cohort = {
  id: string;
  course_id: string;
  framework_id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  graduation_date: string | null;
  status: CohortStatus;
  pre_link_token: string;
  post_link_token: string;
  pass_threshold: number;
};

export type Gender = 'male' | 'female' | 'other' | 'prefer_not_to_say';
export type AgeGroup = '15-24' | '25-34' | '35-44' | '45+';
export type LocationType = 'urban' | 'rural' | 'peri-urban';
export type DisabilityStatus = 'yes' | 'no' | 'prefer_not_to_say';

export type LearnerDemographics = {
  gender?: Gender;
  age_group?: AgeGroup;
  location_type?: LocationType;
  disability?: DisabilityStatus;
};

export type SessionType = 'pre' | 'post';
export type SessionStatus = 'started' | 'completed' | 'flagged';
export type FlagReason = 'outlier' | 'duplicate' | 'gaming' | 'incomplete';

export type AssessmentStartResponse = {
  learner_token: string;
  session_id: string;
  questions: Array<Pick<Question, 'id' | 'area_id' | 'question_text' | 'option_a' | 'option_b' | 'option_c' | 'option_d'>>;
};

export type ScoreSummary = {
  session_type: SessionType;
  total_score: number;
  pre_score: number | null;
  post_score: number | null;
  gain: number | null;
  competency_breakdown: Array<{ area_name: string; pre_pct: number | null; post_pct: number | null }>;
};

export type CohortDashboard = {
  total_enrolled: number;
  pre_completed: number;
  post_completed: number;
  missing_count: number;
  mean_pre_score: number | null;
  mean_post_score: number | null;
  mean_gain: number | null;
  pass_rate: number | null;
  competency_breakdown: Array<{ area_id: string; area_name: string; pre_pct: number | null; post_pct: number | null }>;
  learners: Array<{
    learner_id: string;
    display_name: string | null;
    pre_status: SessionStatus | 'not_started';
    post_status: SessionStatus | 'not_started';
    pre_score: number | null;
    post_score: number | null;
    gain: number | null;
    flag_reason: FlagReason | null;
  }>;
};

export type EquityBreakdown = {
  dimension: 'gender' | 'age_group' | 'location_type' | 'disability';
  groups: Array<{
    label: string;
    n: number;
    mean_gain: number | null;
    mean_pre: number | null;
    mean_post: number | null;
    pass_rate: number | null;
    small_sample: boolean;
  }>;
};
