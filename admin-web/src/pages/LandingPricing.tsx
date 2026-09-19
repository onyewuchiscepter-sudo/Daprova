import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE } from '../api';

type Tier = {
  tier_id: string;
  display_name: string;
  students_per_year_min: number;
  students_per_year_max: number | null;
  base_fee_monthly_ngn: number | null;
  base_fee_per_cohort_cycle_ngn: number | null;
  assessment_fee_per_learner_ngn: number;
  concurrent_cohorts_limit: number | null;
  funder_reports_included_per_year: number | null;
  additional_report_fee_ngn: number | null;
  features: {
    analytics_scores: string;
    equity_dashboard: boolean;
    multi_cohort_trend_comparison: boolean;
    live_funder_monitoring_link: false | string;
    tracer_survey: boolean;
    certificate_white_label_option?: boolean;
    support_tier: string;
  };
};
type Pricing = { free_trial_learners: number; enterprise_threshold: number; tiers: Tier[] };

// Shown until /public/pricing answers (and if it can't be reached). The API
// reads the same pricing table billing charges from, so it wins.
const FALLBACK: Pricing = {
  free_trial_learners: 50,
  enterprise_threshold: 1000,
  tiers: [
    t('starter', 'Starter', 0, 250, 25000, 85000, 1000, 1, 1, 25000, 'basic', false, false, false, false, 'email_selfserve'),
    t('growth', 'Growth', 250, 500, 33000, 112000, 1000, 3, 2, 18000, 'full', true, false, 'single_funder_view', true, 'email_plus_onboarding_call'),
    t('scale', 'Scale', 500, 1000, 40000, 135000, 1000, null, 4, 10000, 'full', true, true, 'multi_funder_historical', true, 'priority'),
    t('enterprise', 'Enterprise', 1000, null, null, null, 800, null, null, null, 'custom', true, true, 'multi_funder_portfolio_ready', true, 'dedicated_account_contact'),
  ],
};
function t(
  tier_id: string,
  display_name: string,
  min: number,
  max: number | null,
  monthly: number | null,
  cycle: number | null,
  perLearner: number,
  cohorts: number | null,
  reports: number | null,
  extraReport: number | null,
  analytics: string,
  equity: boolean,
  compare: boolean,
  link: false | string,
  tracer: boolean,
  support: string,
): Tier {
  return {
    tier_id,
    display_name,
    students_per_year_min: min,
    students_per_year_max: max,
    base_fee_monthly_ngn: monthly,
    base_fee_per_cohort_cycle_ngn: cycle,
    assessment_fee_per_learner_ngn: perLearner,
    concurrent_cohorts_limit: cohorts,
    funder_reports_included_per_year: reports,
    additional_report_fee_ngn: extraReport,
    features: {
      analytics_scores: analytics,
      equity_dashboard: equity,
      multi_cohort_trend_comparison: compare,
      live_funder_monitoring_link: link,
      tracer_survey: tracer,
      certificate_white_label_option: tier_id === 'enterprise',
      support_tier: support,
    },
  };
}

const naira = (v: number) => `₦${v.toLocaleString('en-NG')}`;
const SUPPORT: Record<string, string> = {
  email_selfserve: 'Email support',
  email_plus_onboarding_call: 'Email support + onboarding call',
  priority: 'Priority support',
  dedicated_account_contact: 'A dedicated account contact',
};
const LINK: Record<string, string> = {
  single_funder_view: 'Live results link for a funder (one per cohort)',
  multi_funder_historical: 'Live results links for every funder',
  multi_funder_portfolio_ready: 'Portfolio-wide funder links',
};

function features(tier: Tier): string[] {
  const f = tier.features;
  const list = [
    tier.concurrent_cohorts_limit === null ? 'Unlimited cohorts at once' : `${tier.concurrent_cohorts_limit} cohort${tier.concurrent_cohorts_limit === 1 ? '' : 's'} running at once`,
    f.analytics_scores === 'basic' ? 'Scores, gains and pass rates' : "Full analytics: effect size, confidence, filters",
    'Certificates with online verification',
    'Reminders by email, SMS and WhatsApp',
  ];
  if (f.equity_dashboard) list.push('Equity dashboard by gender, age, location and disability');
  if (f.tracer_survey) list.push('Follow-up survey 3–6 months later');
  if (f.live_funder_monitoring_link) list.push(LINK[f.live_funder_monitoring_link] ?? 'Live funder links');
  if (f.multi_cohort_trend_comparison) list.push('Compare cohorts over time');
  if (f.certificate_white_label_option) list.push('White-label option');
  list.push(
    tier.funder_reports_included_per_year === null
      ? 'Funder reports as agreed'
      : `${tier.funder_reports_included_per_year} funder report${tier.funder_reports_included_per_year === 1 ? '' : 's'} a year included${tier.additional_report_fee_ngn ? `, then ${naira(tier.additional_report_fee_ngn)} each` : ''}`,
  );
  list.push(SUPPORT[f.support_tier] ?? f.support_tier);
  return list;
}

// Public plans. The plan follows how many learners an organisation assesses
// in a year, so there's nothing to pick at signup beyond how to be billed.
export default function LandingPricing() {
  const [pricing, setPricing] = useState<Pricing>(FALLBACK);
  const [cycle, setCycle] = useState<'monthly' | 'per_cohort_cycle'>('monthly');

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`${API_BASE}/api/v1/public/pricing`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((p: Pricing | null) => p?.tiers?.length && setPricing(p))
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  return (
    <section className="dp-section" id="pricing">
      <div className="dp-section-head">
        <p className="dp-eyebrow">Pricing</p>
        <h2 className="dp-h2">Pay for learners you actually measure.</h2>
        <p className="dp-sub">
          A small base fee, plus {naira(pricing.tiers[0].assessment_fee_per_learner_ngn)} for each learner who completes both the pre- and post-assessment,
          certificate included. Your plan follows how many learners you assess in a year, so it grows with you.
        </p>
      </div>

      <div className="dp-free">
        <strong>Your first cohort is free.</strong> No base fee and no card, with assessments for up to {pricing.free_trial_learners} learners included.
      </div>

      <div className="dp-cycle" role="group" aria-label="Billing">
        <button type="button" aria-pressed={cycle === 'monthly'} onClick={() => setCycle('monthly')}>
          Billed monthly
        </button>
        <button type="button" aria-pressed={cycle === 'per_cohort_cycle'} onClick={() => setCycle('per_cohort_cycle')}>
          Billed per cohort
        </button>
      </div>

      <div className="dp-plans">
        {pricing.tiers.map((tier) => {
          const base = cycle === 'monthly' ? tier.base_fee_monthly_ngn : tier.base_fee_per_cohort_cycle_ngn;
          const enterprise = base === null;
          return (
            <article className={`dp-plan${tier.tier_id === 'growth' ? ' dp-plan-featured' : ''}`} key={tier.tier_id}>
              <p className="dp-eyebrow">
                {tier.students_per_year_max === null
                  ? `${tier.students_per_year_min.toLocaleString()}+ learners / year`
                  : `${tier.students_per_year_min === 0 ? 'Up to ' : `${tier.students_per_year_min}–`}${(tier.students_per_year_max - 1).toLocaleString()} learners / year`}
              </p>
              <h3>{tier.display_name}</h3>
              <p className="dp-plan-price">
                {enterprise ? (
                  <span className="dp-num">Custom</span>
                ) : (
                  <>
                    <span className="dp-num">{naira(base)}</span>
                    <span className="dp-plan-per">{cycle === 'monthly' ? '/ month' : '/ cohort'}</span>
                  </>
                )}
              </p>
              <p className="dp-plan-sub">
                + <span className="dp-num">{naira(tier.assessment_fee_per_learner_ngn)}</span> per learner assessed
              </p>
              <ul>
                {features(tier).map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {enterprise ? (
                <a href="mailto:sales@daprova.com?subject=Daprova%20Enterprise" className="dp-btn dp-btn-ghost">
                  Contact sales
                </a>
              ) : (
                <Link to="/signup" className={`dp-btn${tier.tier_id === 'growth' ? '' : ' dp-btn-ghost'}`}>
                  Start free
                </Link>
              )}
            </article>
          );
        })}
      </div>
      <p className="dp-plan-note">
        Prices in Naira. Fees for learners are charged when a cohort is finished, and only for those who completed both assessments. Plans change at
        the start of a billing cycle, never backdated.
      </p>
    </section>
  );
}
