import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { apiFetch, apiFetchBlob } from '../api';
import ReportsPanel from '../components/ReportsPanel';
import UpgradePrompt from '../components/UpgradePrompt';
import { useAuth } from '../auth';
import RemindersPanel from '../components/RemindersPanel';
import SharePanel from '../components/SharePanel';
import OutcomesPanel from '../components/OutcomesPanel';

type Cohort = {
  id: string;
  name: string;
  status: string;
  pre_link_token: string;
  post_link_token: string;
  satisfaction_link_token: string;
  tracer_link_token: string;
  total_enrolled: number;
  pre_completed: number;
  post_completed: number;
  is_free_trial: boolean;
  finalized_at: string | null;
  end_date: string | null;
  plan: {
    tier_id: string;
    name: string;
    assessment_fee_per_learner_ngn: number;
    features: { analytics_scores: string; equity_dashboard: boolean; tracer_survey: boolean; live_funder_monitoring_link: false | string };
  };
};
type FinalizePreview = {
  finalized: boolean;
  learners_completed: number;
  learners_waived: number;
  learners_billed: number;
  fee_per_learner_ngn: number;
  total_ngn: number;
  tier: string;
};
type LearnerRow = {
  learner_id: string;
  display_name: string | null;
  gender: string | null;
  age_group: string | null;
  location_type: string | null;
  disability: string | null;
  pre_status: string;
  post_status: string;
  pre_score: string | null;
  post_score: string | null;
  email: string | null;
  phone: string | null;
  certificate_code: string | null;
};
type DashboardAnalytics = {
  mean_gain: number | null;
  mean_pre_score: number | null;
  mean_post_score: number | null;
  n_learners: number;
  cohens_d: number | null;
  pass_rate: number | null;
  competency_breakdown: Array<{ area_id: string; area_name: string; pre_pct: number | null; post_pct: number | null }>;
  self_ratings: Array<{ area_id: string; area_name: string; pre_avg: number | null; post_avg: number | null; n: number }>;
  analytics_level?: string;
};
type EquityGroup = {
  label: string;
  n: number;
  mean_gain: number | null;
  mean_pre: number | null;
  mean_post: number | null;
  pass_rate: number | null;
  confidence_gain: number | null;
  small_sample: boolean;
};
type EquityBreakdown = { dimension: string; groups: EquityGroup[] };
type SatisfactionSummary = {
  response_count: number;
  avg_instructor_rating: number | null;
  avg_content_relevance: number | null;
  avg_delivery_satisfaction: number | null;
  nps_score: number | null;
  nps_promoters: number;
  nps_passives: number;
  nps_detractors: number;
  comments: Array<{ positive: string | null; improve: string | null; created_at: string }>;
};

// Falls back to localhost for dev; set VITE_ASSESSMENT_WEB_ORIGIN at build
// time to the real deployed assessment-web URL (or eventually
// app.daprova.com per the spec, US-06) in production.
const ASSESSMENT_WEB_ORIGIN = import.meta.env.VITE_ASSESSMENT_WEB_ORIGIN ?? 'http://localhost:5174';

const FILTER_DIMENSIONS = ['gender', 'age_group', 'location_type', 'disability'] as const;
const FILTER_OPTIONS: Record<(typeof FILTER_DIMENSIONS)[number], Array<[string, string]>> = {
  gender: [
    ['male', 'Male'],
    ['female', 'Female'],
    ['other', 'Other'],
    ['prefer_not_to_say', 'Prefer not to say'],
  ],
  age_group: [
    ['15-24', '15–24'],
    ['25-34', '25–34'],
    ['35-44', '35–44'],
    ['45+', '45+'],
  ],
  location_type: [
    ['urban', 'Urban'],
    ['rural', 'Rural'],
    ['peri-urban', 'Peri-urban'],
  ],
  disability: [
    ['no', 'No'],
    ['yes', 'Yes'],
    ['prefer_not_to_say', 'Prefer not to say'],
  ],
};
const DIMENSION_LABEL: Record<string, string> = { gender: 'Gender', age_group: 'Age group', location_type: 'Location', disability: 'Disability' };

export default function CohortDashboardPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  // FR-M3-05: filter state lives in URL params so it survives a refresh.
  const [searchParams, setSearchParams] = useSearchParams();
  type Tab = 'overview' | 'equity' | 'satisfaction' | 'outcomes' | 'reports';
  const TABS: Tab[] = ['overview', 'equity', 'satisfaction', 'outcomes', 'reports'];
  const [tab, setTab] = useState<Tab>(() => {
    const t = searchParams.get('tab') as Tab | null;
    return t && TABS.includes(t) ? t : 'overview';
  });
  type RemindKind = 'post' | 'satisfaction' | 'tracer';
  const [remindKind, setRemindKind] = useState<RemindKind | null>(() => {
    const k = searchParams.get('remind');
    return k === 'post' || k === 'satisfaction' || k === 'tracer' ? k : null;
  });
  const [sharing, setSharing] = useState(false);
  useEffect(() => {
    if (!searchParams.get('tab') && !searchParams.get('remind')) return;
    const next = new URLSearchParams(searchParams);
    next.delete('tab');
    next.delete('remind');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const filters = Object.fromEntries(FILTER_DIMENSIONS.map((d) => [d, searchParams.get(d) ?? '']).filter(([, v]) => v)) as Record<string, string>;
  const hasFilters = Object.keys(filters).length > 0;

  function setFilter(dimension: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(dimension, value);
    else next.delete(dimension);
    setSearchParams(next, { replace: true });
  }
  function clearFilters() {
    setSearchParams({}, { replace: true });
  }

  const dashboardQueryString = new URLSearchParams(filters).toString();

  // FR-M2-11: real-time-ish completion status via polling rather than a
  // websocket — the dashboard's "soft real-time" UX doesn't need the
  // connection-scaling complexity a socket channel would add.
  const { data: cohort } = useQuery<Cohort>({
    queryKey: ['cohort', id],
    queryFn: () => apiFetch(`/api/v1/cohorts/${id}`),
    refetchInterval: 5000,
  });
  const { data: learners } = useQuery<LearnerRow[]>({
    queryKey: ['cohort-learners', id],
    queryFn: () => apiFetch(`/api/v1/cohorts/${id}/learners`),
    refetchInterval: 5000,
  });
  // US-11/US-13: mean pre/post/gain, pass rate, and competency breakdown —
  // refetches whenever the demographic filters change so every metric here
  // updates together (compound filters, all optional).
  const { data: analytics } = useQuery<DashboardAnalytics>({
    queryKey: ['cohort-dashboard', id, dashboardQueryString],
    queryFn: () => apiFetch(`/api/v1/cohorts/${id}/dashboard${dashboardQueryString ? `?${dashboardQueryString}` : ''}`),
    refetchInterval: 5000,
  });
  // US-12: equity tab shows every subgroup broken out automatically per
  // dimension — independent of the filter bar above, which narrows the
  // Overview tab to one specific subgroup instead.
  const { data: equity } = useQuery<EquityBreakdown[]>({
    queryKey: ['cohort-equity', id],
    queryFn: () => apiFetch(`/api/v1/cohorts/${id}/equity`),
    refetchInterval: 5000,
    enabled: tab === 'equity' && cohort?.plan.features.equity_dashboard === true,
  });

  // Module 5 (S11): learner satisfaction survey aggregate — no polling since
  // it only changes when a learner submits feedback, not every 5s.
  const { data: satisfaction } = useQuery<SatisfactionSummary>({
    queryKey: ['cohort-satisfaction', id],
    queryFn: () => apiFetch(`/api/v1/cohorts/${id}/satisfaction`),
    enabled: tab === 'satisfaction',
  });

  const regenerateMutation = useMutation({
    mutationFn: (type: 'pre' | 'post' | 'satisfaction' | 'tracer') =>
      apiFetch(`/api/v1/cohorts/${id}/regenerate-link`, { method: 'POST', body: JSON.stringify({ type }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cohort', id] }),
  });

  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  // Pricing spec: finalising closes the cohort and invoices the assessment
  // fee for every learner who completed both pre and post.
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const { data: finalizePreview } = useQuery<FinalizePreview>({
    queryKey: ['cohort-finalize', id],
    queryFn: () => apiFetch(`/api/v1/cohorts/${id}/finalize`),
    enabled: confirmFinalize,
  });
  const finalizeMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/cohorts/${id}/finalize`, { method: 'POST' }),
    onSuccess: () => {
      setConfirmFinalize(false);
      queryClient.invalidateQueries({ queryKey: ['cohort', id] });
      queryClient.invalidateQueries({ queryKey: ['billing'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
  });

  function copyLink(token: string, basePath: 'assess' | 'satisfaction' | 'tracer' = 'assess') {
    navigator.clipboard.writeText(`${ASSESSMENT_WEB_ORIGIN}/${basePath}/${token}`);
  }

  async function downloadCertificate(l: LearnerRow) {
    const blob = await apiFetchBlob(`/api/v1/cohorts/${id}/learners/${l.learner_id}/certificate`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `certificate-${(l.display_name ?? 'learner').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    queryClient.invalidateQueries({ queryKey: ['cohort-learners', id] });
  }

  async function downloadLearnersCsv() {
    const blob = await apiFetchBlob(`/api/v1/cohorts/${id}/learners/export.csv`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cohort?.name ?? 'learners'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!cohort) return <p className="text-ink-soft">Loading…</p>;

  const prePct = cohort.total_enrolled > 0 ? Math.round((cohort.pre_completed / cohort.total_enrolled) * 100) : 0;
  const postPct = cohort.total_enrolled > 0 ? Math.round((cohort.post_completed / cohort.total_enrolled) * 100) : 0;
  const missing = cohort.total_enrolled - cohort.post_completed;

  const features = cohort.plan.features;
  const basicAnalytics = features.analytics_scores === 'basic';
  const filteredLearners = learners?.filter((l) => FILTER_DIMENSIONS.every((d) => !filters[d] || l[d] === filters[d]));

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <h1 className="font-display font-semibold text-[26px] leading-tight tracking-[-0.015em] text-ink">{cohort.name}</h1>
        <div className="flex gap-2">
          <button onClick={() => setRemindKind('post')} className="text-sm border border-rule rounded px-3 py-1.5 hover:border-ink">
            Send reminders
          </button>
          <button onClick={() => setSharing(true)} className="text-sm border border-rule rounded px-3 py-1.5 hover:border-ink">
            Share with funder
          </button>
        </div>
      </div>
      <p className="text-sm text-ink-soft mb-6">
        <span className="capitalize">{cohort.status.replace(/_/g, ' ')}</span>
        <span className="mx-2 text-rule">|</span>
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-sage">{cohort.plan.name} plan</span>
      </p>

      {cohort.finalized_at ? (
        <div className="mb-6 rounded-md px-4 py-3 text-sm bg-ground text-ink-soft border border-rule">
          This cohort was finalised on {new Date(cohort.finalized_at).toLocaleDateString()}. Its results, reports and certificates stay available; new
          assessments are closed.
        </div>
      ) : (
        isAdmin && (
          <div className="mb-6 rounded-md px-4 py-3 text-sm bg-paper border border-rule">
            {!confirmFinalize ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-ink-soft">
                  {cohort.is_free_trial ? 'Free trial cohort. ' : ''}When the programme is over, finalise the cohort to close assessments and issue its invoice
                  {cohort.end_date ? ` (it finalises automatically 14 days after ${new Date(cohort.end_date).toLocaleDateString()})` : ''}.
                </span>
                <button onClick={() => setConfirmFinalize(true)} className="shrink-0 text-sm border border-rule rounded px-3 py-1.5 hover:border-ink">
                  Finalise cohort…
                </button>
              </div>
            ) : !finalizePreview ? (
              <p className="text-ink-soft">Working out the total…</p>
            ) : (
              <div>
                <p className="text-ink">
                  <strong>{finalizePreview.learners_completed}</strong> learner{finalizePreview.learners_completed === 1 ? '' : 's'} completed both assessments.
                  {finalizePreview.learners_waived > 0 && ` ${finalizePreview.learners_waived} are free under your trial.`}{' '}
                  {finalizePreview.learners_billed > 0
                    ? `${finalizePreview.learners_billed} × ₦${finalizePreview.fee_per_learner_ngn.toLocaleString()} = ₦${finalizePreview.total_ngn.toLocaleString()} will be invoiced (${finalizePreview.tier} plan).`
                    : 'Nothing will be charged.'}
                </p>
                <p className="text-xs text-sage mt-1">Learners who haven't taken the post-assessment yet won't be able to after this. This can't be undone.</p>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => finalizeMutation.mutate()}
                    disabled={finalizeMutation.isPending}
                    className="text-sm bg-gain text-white rounded px-3 py-1.5 disabled:opacity-50"
                  >
                    {finalizeMutation.isPending ? 'Finalising…' : 'Finalise now'}
                  </button>
                  <button onClick={() => setConfirmFinalize(false)} className="text-sm border rounded px-3 py-1.5">
                    Cancel
                  </button>
                </div>
                {finalizeMutation.isError && <p className="text-xs text-flag mt-2">{(finalizeMutation.error as Error).message}</p>}
              </div>
            )}
          </div>
        )
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <LinkCard label="Pre-assessment link" token={cohort.pre_link_token} onCopy={copyLink} onRegenerate={() => regenerateMutation.mutate('pre')} />
        <LinkCard label="Post-assessment link" token={cohort.post_link_token} onCopy={copyLink} onRegenerate={() => regenerateMutation.mutate('post')} />
        <LinkCard
          label="Satisfaction survey link"
          token={cohort.satisfaction_link_token}
          basePath="satisfaction"
          onCopy={(t) => copyLink(t, 'satisfaction')}
          onRegenerate={() => regenerateMutation.mutate('satisfaction')}
        />
        {features.tracer_survey && (
          <LinkCard
            label="Follow-up survey link (3–6 months on)"
            token={cohort.tracer_link_token}
            basePath="tracer"
            onCopy={(t) => copyLink(t, 'tracer')}
            onRegenerate={() => regenerateMutation.mutate('tracer')}
          />
        )}
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <Stat label="Total enrolled" value={cohort.total_enrolled} />
        <Stat label="Pre completed" value={`${cohort.pre_completed} (${prePct}%)`} />
        <Stat label="Post completed" value={`${cohort.post_completed} (${postPct}%)`} />
        <button onClick={() => setRemindKind('post')} className="text-left" title="Send reminders">
          <Stat label="Missing (not yet post) · remind" value={missing} />
        </button>
      </div>

      {/* FR-M3-04: equity view lives as a tab within this same dashboard. */}
      <div className="flex gap-4 border-b mb-6">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2 text-sm font-medium capitalize border-b-2 -mb-px ${tab === t ? 'border-gain text-ink' : 'border-transparent text-ink-soft'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* US-13: compound demographic filters — applying any of them updates
          the Overview tab's stats, competency breakdown, and learner table
          together via the same query. Not applicable to the Reports tab. */}
      {tab !== 'reports' && tab !== 'satisfaction' && tab !== 'outcomes' && !basicAnalytics && (tab !== 'equity' || features.equity_dashboard) && (
        <div className="bg-paper rounded-lg border border-rule p-4 mb-6 flex flex-wrap items-end gap-3">
          {FILTER_DIMENSIONS.map((dim) => (
            <label key={dim} className="text-xs text-ink-soft">
              {DIMENSION_LABEL[dim]}
              <select
                className="mt-1 block border rounded px-2 py-1.5 text-sm text-ink"
                value={filters[dim] ?? ''}
                onChange={(e) => setFilter(dim, e.target.value)}
              >
                <option value="">All</option>
                {FILTER_OPTIONS[dim].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {hasFilters && (
            <button onClick={clearFilters} className="text-xs text-ink-soft underline pb-1.5">
              Clear filters
            </button>
          )}
        </div>
      )}

      {tab === 'overview' && (
        <>
          {analytics && analytics.n_learners > 0 && (
            <>
              <div className="grid grid-cols-4 gap-4 mb-6">
                <Stat label="Mean pre score" value={analytics.mean_pre_score !== null ? `${analytics.mean_pre_score}%` : '—'} />
                <Stat label="Mean post score" value={analytics.mean_post_score !== null ? `${analytics.mean_post_score}%` : '—'} />
                <Stat label="Mean gain" value={analytics.mean_gain !== null ? `${analytics.mean_gain >= 0 ? '+' : ''}${analytics.mean_gain} pts` : '—'} />
                <Stat label="Pass rate" value={analytics.pass_rate !== null ? `${analytics.pass_rate}%` : '—'} />
              </div>

              <div className="bg-paper rounded-lg border border-rule p-5 mb-6">
                <h3 className="font-display font-semibold text-[16px] tracking-[-0.01em] text-ink mb-3">Competency breakdown</h3>
                <div className="space-y-2">
                  {analytics.competency_breakdown.map((area) => (
                    <div key={area.area_id} className="flex items-center justify-between text-sm">
                      <span className="text-ink">{area.area_name}</span>
                      <span className="text-ink-soft">
                        {area.pre_pct !== null ? `${area.pre_pct}%` : '—'} → {area.post_pct !== null ? `${area.post_pct}%` : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              {analytics.self_ratings.length > 0 && (
                <div className="bg-paper rounded-lg border border-rule p-5 mb-6">
                  <h3 className="font-display font-semibold text-[16px] tracking-[-0.01em] text-ink mb-1">Self-rated confidence</h3>
                  <p className="text-xs text-sage mb-3">How learners rated themselves (1–5) — not part of their score.</p>
                  <div className="space-y-2">
                    {analytics.self_ratings.map((a) => (
                      <div key={a.area_id} className="flex items-center justify-between text-sm">
                        <span className="text-ink">{a.area_name}</span>
                        <span className="font-mono text-ink-soft">
                          {a.pre_avg ?? '—'} → {a.post_avg ?? '—'} <span className="text-sage">/ 5</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          {analytics && analytics.n_learners === 0 && hasFilters && (
            <div className="bg-paper rounded-lg border border-rule p-5 mb-6 text-sm text-ink-soft">No learners match the selected filters.</div>
          )}

          <div className="flex justify-end mb-2">
            <button onClick={downloadLearnersCsv} className="text-sm border rounded px-3 py-1.5 hover:border-ink">
              Export CSV
            </button>
          </div>

          <div className="bg-paper rounded-lg border border-rule overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-ground text-left text-ink-soft">
                <tr>
                  <th className="p-3">Learner</th>
                  <th className="p-3">Pre</th>
                  <th className="p-3">Post</th>
                  <th className="p-3">Gain</th>
                  <th className="p-3">Certificate</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredLearners?.map((l) => {
                  const pre = l.pre_score !== null ? Number(l.pre_score) : null;
                  const post = l.post_score !== null ? Number(l.post_score) : null;
                  const gain = pre !== null && post !== null ? Math.round((post - pre) * 100) / 100 : null;
                  return (
                    <tr key={l.learner_id}>
                      <td className="p-3">
                        {l.display_name ?? l.learner_id.slice(0, 8)}
                        {(l.email || l.phone) && <span className="ml-2 text-[11px] text-sage" title={[l.email, l.phone].filter(Boolean).join(' · ')}>✉</span>}
                      </td>
                      <td className="p-3">
                        <StatusBadge status={l.pre_status} score={pre} />
                      </td>
                      <td className="p-3">
                        <StatusBadge status={l.post_status} score={post} />
                      </td>
                      <td className="p-3">{gain !== null ? (gain >= 0 ? '+' : '') + gain : '—'}</td>
                      <td className="p-3">
                        {l.post_status === 'completed' ? (
                          <button onClick={() => downloadCertificate(l)} className="text-xs underline text-ink" title={l.certificate_code ?? undefined}>
                            Download
                          </button>
                        ) : (
                          <span className="text-xs text-sage">After post</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filteredLearners?.length === 0 && (
                  <tr>
                    <td className="p-3 text-ink-soft" colSpan={5}>
                      {hasFilters ? 'No learners match the selected filters.' : 'No learners yet — share the pre-assessment link to get started.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'overview' && basicAnalytics && (
        <p className="text-xs text-sage mb-4">
          Your plan includes basic analytics. Filtering by gender, age, location and disability, effect sizes and self-rated confidence come with Growth and
          above — <Link to="/billing" className="underline">see plans</Link>.
        </p>
      )}

      {tab === 'equity' && !features.equity_dashboard && (
        <UpgradePrompt title="Equity dashboard" requiredTier="growth">
          See how results differ by gender, age group, location and disability — the breakdown funders increasingly ask for.
        </UpgradePrompt>
      )}

      {tab === 'equity' && features.equity_dashboard && (
        <div className="space-y-6">
          {equity?.map((breakdown) => (
            <div key={breakdown.dimension} className="bg-paper rounded-lg border border-rule overflow-hidden">
              <h3 className="font-display font-semibold text-[16px] tracking-[-0.01em] text-ink p-4 pb-0">{DIMENSION_LABEL[breakdown.dimension] ?? breakdown.dimension}</h3>
              <table className="w-full text-sm mt-3">
                <thead className="bg-ground text-left text-ink-soft">
                  <tr>
                    <th className="p-3">Group</th>
                    <th className="p-3">n</th>
                    <th className="p-3">Mean pre</th>
                    <th className="p-3">Mean post</th>
                    <th className="p-3">Mean gain</th>
                    <th className="p-3">Confidence gain</th>
                    <th className="p-3">Pass rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {breakdown.groups.map((g) => (
                    <tr key={g.label} className={g.small_sample ? 'opacity-60' : ''}>
                      <td className="p-3">
                        {g.label.replace(/_/g, ' ')}
                        {g.small_sample && (
                          <span className="ml-2 text-xs bg-amber-wash text-amber rounded px-2 py-0.5" title="Sample too small — treat with caution">
                            n&lt;5 ⚠
                          </span>
                        )}
                      </td>
                      <td className="p-3">{g.n}</td>
                      <td className="p-3">{g.mean_pre !== null ? `${g.mean_pre}%` : '—'}</td>
                      <td className="p-3">{g.mean_post !== null ? `${g.mean_post}%` : '—'}</td>
                      <td className="p-3">{g.mean_gain !== null ? `${g.mean_gain >= 0 ? '+' : ''}${g.mean_gain}` : '—'}</td>
                      <td className="p-3">{g.confidence_gain !== null ? `${g.confidence_gain >= 0 ? '+' : ''}${g.confidence_gain}` : '—'}</td>
                      <td className="p-3">{g.pass_rate !== null ? `${g.pass_rate}%` : '—'}</td>
                    </tr>
                  ))}
                  {breakdown.groups.length === 0 && (
                    <tr>
                      <td className="p-3 text-ink-soft" colSpan={7}>
                        No data yet for this dimension.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {tab === 'satisfaction' && (
        <div className="space-y-6">
          {satisfaction && satisfaction.response_count === 0 && (
            <div className="bg-paper rounded-lg border border-rule p-5 text-sm text-ink-soft">
              No satisfaction survey responses yet — these are collected on the post-assessment link after a learner submits.
            </div>
          )}
          {satisfaction && satisfaction.response_count > 0 && (
            <>
              <div className="grid grid-cols-4 gap-4">
                <Stat label="Responses" value={satisfaction.response_count} />
                <Stat label="Instructor rating" value={satisfaction.avg_instructor_rating !== null ? `${satisfaction.avg_instructor_rating} / 5` : '—'} />
                <Stat label="Content relevance" value={satisfaction.avg_content_relevance !== null ? `${satisfaction.avg_content_relevance} / 5` : '—'} />
                <Stat label="Delivery satisfaction" value={satisfaction.avg_delivery_satisfaction !== null ? `${satisfaction.avg_delivery_satisfaction} / 5` : '—'} />
              </div>

              <div className="bg-paper rounded-lg border border-rule p-5">
                <h3 className="font-display font-semibold text-[16px] tracking-[-0.01em] text-ink mb-3">Net Promoter Score</h3>
                <div className="flex items-center gap-6">
                  <div>
                    <p className="text-2xl font-semibold text-ink">{satisfaction.nps_score !== null ? satisfaction.nps_score : '—'}</p>
                    <p className="text-xs text-ink-soft">−100 to +100</p>
                  </div>
                  <div className="flex-1 grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-ink-soft">Promoters (9–10)</p>
                      <p className="font-medium text-gain">{satisfaction.nps_promoters}</p>
                    </div>
                    <div>
                      <p className="text-ink-soft">Passives (7–8)</p>
                      <p className="font-medium text-ink">{satisfaction.nps_passives}</p>
                    </div>
                    <div>
                      <p className="text-ink-soft">Detractors (0–6)</p>
                      <p className="font-medium text-flag">{satisfaction.nps_detractors}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-paper rounded-lg border border-rule p-5">
                <h3 className="font-display font-semibold text-[16px] tracking-[-0.01em] text-ink mb-3">Learner comments</h3>
                <div className="space-y-3">
                  {satisfaction.comments.map((c, i) => (
                    <div key={i} className="text-sm border-b last:border-b-0 pb-3 last:pb-0">
                      {c.positive && (
                        <p className="text-ink">
                          <span className="text-gain font-medium">Liked: </span>
                          {c.positive}
                        </p>
                      )}
                      {c.improve && (
                        <p className="text-ink mt-1">
                          <span className="text-amber font-medium">Could improve: </span>
                          {c.improve}
                        </p>
                      )}
                      <p className="text-xs text-sage mt-1">{new Date(c.created_at).toLocaleDateString()}</p>
                    </div>
                  ))}
                  {satisfaction.comments.length === 0 && <p className="text-sm text-ink-soft">No written comments yet.</p>}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'outcomes' &&
        (features.tracer_survey ? (
          <OutcomesPanel cohortId={cohort.id} onRemind={() => setRemindKind('tracer')} />
        ) : (
          <UpgradePrompt title="Follow-up (tracer) survey" requiredTier="growth">
            Check in with learners 3–6 months after the programme — jobs, income, further study — and add those outcomes to funder reports.
          </UpgradePrompt>
        ))}

      {remindKind && <RemindersPanel cohortId={cohort.id} initialKind={remindKind} tracerEnabled={features.tracer_survey} onClose={() => setRemindKind(null)} />}
      {sharing &&
        (features.live_funder_monitoring_link ? (
          <SharePanel cohortId={cohort.id} onClose={() => setSharing(false)} />
        ) : (
          <div className="fixed inset-0 bg-ink/40 flex items-center justify-center p-4 z-40" onClick={() => setSharing(false)}>
            <div className="max-w-md w-full" onClick={(e) => e.stopPropagation()}>
              <UpgradePrompt title="Live funder link" requiredTier="growth">
                Give a funder a read-only link to this cohort's live results instead of sending files back and forth.
              </UpgradePrompt>
            </div>
          </div>
        ))}

      {tab === 'reports' && <ReportsPanel cohortId={cohort.id} />}
    </div>
  );
}

function LinkCard({
  label,
  token,
  basePath = 'assess',
  onCopy,
  onRegenerate,
}: {
  label: string;
  token: string;
  basePath?: 'assess' | 'satisfaction' | 'tracer';
  onCopy: (t: string) => void;
  onRegenerate: () => void;
}) {
  return (
    <div className="bg-paper rounded-lg border border-rule p-4">
      <p className="text-xs font-medium text-ink-soft mb-1">{label}</p>
      <p className="text-xs text-ink truncate mb-2">
        {ASSESSMENT_WEB_ORIGIN}/{basePath}/{token}
      </p>
      <div className="flex gap-2">
        <button onClick={() => onCopy(token)} className="text-xs border rounded px-2 py-1 hover:border-ink">
          Copy link
        </button>
        <button onClick={onRegenerate} className="text-xs text-flag hover:underline">
          Regenerate
        </button>
      </div>
    </div>
  );
}

// Figures are mono + tabular: this dashboard polls every 5s, and digits that
// change width as it refreshes read as the layout twitching.
function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-paper rounded-lg border border-rule px-4 py-3.5">
      <p className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-sage">{label}</p>
      <p className="font-mono text-[21px] font-semibold text-ink mt-1">{value}</p>
    </div>
  );
}

function StatusBadge({ status, score }: { status: string; score: number | null }) {
  const color = status === 'completed' ? 'bg-gain-wash text-gain' : status === 'started' ? 'bg-amber-wash text-amber' : 'bg-ground text-ink-soft';
  return (
    <span className={`font-mono text-[11px] rounded px-2 py-1 ${color}`}>
      {status === 'completed' && score !== null ? `${score}%` : status.replace('_', ' ')}
    </span>
  );
}
