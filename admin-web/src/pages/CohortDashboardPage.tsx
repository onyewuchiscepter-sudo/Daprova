import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import { apiFetch, apiFetchBlob, API_BASE } from '../api';

type Cohort = {
  id: string;
  name: string;
  status: string;
  pre_link_token: string;
  post_link_token: string;
  total_enrolled: number;
  pre_completed: number;
  post_completed: number;
  capacity_status: 'allow' | 'warn' | 'block';
  max_students: number | null;
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
};
type DashboardAnalytics = {
  mean_gain: number | null;
  mean_pre_score: number | null;
  mean_post_score: number | null;
  n_learners: number;
  cohens_d: number | null;
  pass_rate: number | null;
  competency_breakdown: Array<{ area_id: string; area_name: string; pre_pct: number | null; post_pct: number | null }>;
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
type ReportTemplate = { key: string; label: string };
type NarrativeFields = { background: string; challenges: string; next_steps: string };
type ReportRecord = { id: string; funder_template: string; narrative_json: NarrativeFields; status: string; generated_at: string };

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
  const [tab, setTab] = useState<'overview' | 'equity' | 'satisfaction' | 'reports'>('overview');

  // FR-M3-05: filter state lives in URL params so it survives a refresh.
  const [searchParams, setSearchParams] = useSearchParams();
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
    enabled: tab === 'equity',
  });

  // Module 5 (S11): learner satisfaction survey aggregate — no polling since
  // it only changes when a learner submits feedback, not every 5s.
  const { data: satisfaction } = useQuery<SatisfactionSummary>({
    queryKey: ['cohort-satisfaction', id],
    queryFn: () => apiFetch(`/api/v1/cohorts/${id}/satisfaction`),
    enabled: tab === 'satisfaction',
  });

  // Module 4: funder report generation. Templates rarely change, so no
  // polling; the report history refetches after generate/regenerate via
  // query invalidation instead.
  const { data: templates } = useQuery<ReportTemplate[]>({
    queryKey: ['report-templates'],
    queryFn: () => apiFetch('/api/v1/reports/templates'),
    enabled: tab === 'reports',
    staleTime: Infinity,
  });
  const { data: reports } = useQuery<ReportRecord[]>({
    queryKey: ['cohort-reports', id],
    queryFn: () => apiFetch(`/api/v1/cohorts/${id}/reports`),
    enabled: tab === 'reports',
  });

  const regenerateMutation = useMutation({
    mutationFn: (type: 'pre' | 'post') =>
      apiFetch(`/api/v1/cohorts/${id}/regenerate-link`, { method: 'POST', body: JSON.stringify({ type }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cohort', id] }),
  });

  // docs/org-onboarding-spec.md §5.6 — opens the (stub) provider's checkout
  // page in a new tab, same as a real Paystack/Flutterwave redirect would.
  // Re-fetches the cohort afterward so the "locked pending upgrade" banner
  // shows up immediately rather than waiting for the next 5s poll.
  const upgradeMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/cohorts/${id}/upgrade`, { method: 'POST' }),
    onSuccess: (result) => {
      window.open(`${API_BASE}${result.checkoutUrl}`, '_blank');
      queryClient.invalidateQueries({ queryKey: ['cohort', id] });
    },
  });

  const [reportForm, setReportForm] = useState<NarrativeFields>({ background: '', challenges: '', next_steps: '' });
  const [reportTemplate, setReportTemplate] = useState('');
  const [editingReportId, setEditingReportId] = useState<string | null>(null);

  const generateReportMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/cohorts/${id}/reports`, { method: 'POST', body: JSON.stringify({ template: reportTemplate, narrative: reportForm }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cohort-reports', id] });
      setReportForm({ background: '', challenges: '', next_steps: '' });
      setReportTemplate('');
    },
  });
  const regenerateReportMutation = useMutation({
    mutationFn: (reportId: string) => apiFetch(`/api/v1/reports/${reportId}/narrative`, { method: 'PATCH', body: JSON.stringify({ narrative: reportForm }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cohort-reports', id] });
      setEditingReportId(null);
      setReportForm({ background: '', challenges: '', next_steps: '' });
    },
  });

  function startEditingReport(report: ReportRecord) {
    setEditingReportId(report.id);
    setReportForm(report.narrative_json);
  }
  function cancelEditingReport() {
    setEditingReportId(null);
    setReportForm({ background: '', challenges: '', next_steps: '' });
  }

  async function downloadReport(reportId: string, format: 'pdf' | 'docx') {
    const blob = await apiFetchBlob(`/api/v1/reports/${reportId}/download/${format}`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${reportId}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyLink(token: string) {
    navigator.clipboard.writeText(`${ASSESSMENT_WEB_ORIGIN}/assess/${token}`);
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

  if (!cohort) return <p className="text-slate-500">Loading…</p>;

  const prePct = cohort.total_enrolled > 0 ? Math.round((cohort.pre_completed / cohort.total_enrolled) * 100) : 0;
  const postPct = cohort.total_enrolled > 0 ? Math.round((cohort.post_completed / cohort.total_enrolled) * 100) : 0;
  const missing = cohort.total_enrolled - cohort.post_completed;

  const filteredLearners = learners?.filter((l) => FILTER_DIMENSIONS.every((d) => !filters[d] || l[d] === filters[d]));

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900 mb-1">{cohort.name}</h1>
      <p className="text-sm text-slate-500 mb-6 capitalize">{cohort.status}</p>

      {cohort.status === 'locked_pending_upgrade' ? (
        <div className="mb-6 rounded-md px-4 py-3 text-sm bg-red-50 text-red-800 border border-red-200">
          This cohort is locked pending an upgrade payment. Existing data stays visible, but no new students or attempts can be recorded until the
          payment clears.
        </div>
      ) : (
        cohort.capacity_status !== 'allow' && (
          <div
            className={`mb-6 rounded-md px-4 py-3 text-sm flex items-center justify-between gap-4 ${
              cohort.capacity_status === 'block' ? 'bg-red-50 text-red-800 border border-red-200' : 'bg-amber-50 text-amber-800 border border-amber-200'
            }`}
          >
            <span>
              {cohort.capacity_status === 'block'
                ? `This cohort has reached its plan's limit of ${cohort.max_students} students — upgrade to enrol more.`
                : `This cohort is approaching its plan's limit (${cohort.total_enrolled}/${cohort.max_students} students) — consider upgrading soon.`}
            </span>
            {cohort.capacity_status === 'block' && (
              <button
                onClick={() => upgradeMutation.mutate()}
                disabled={upgradeMutation.isPending}
                className="shrink-0 bg-slate-900 text-white text-xs rounded px-3 py-1.5 disabled:opacity-50"
              >
                {upgradeMutation.isPending ? 'Opening checkout…' : 'Upgrade now'}
              </button>
            )}
          </div>
        )
      )}
      {upgradeMutation.isError && (
        <p className="text-sm text-red-600 mb-4">{upgradeMutation.error instanceof Error ? upgradeMutation.error.message : 'Could not start upgrade'}</p>
      )}

      <div className="grid grid-cols-2 gap-4 mb-6">
        <LinkCard label="Pre-assessment link" token={cohort.pre_link_token} onCopy={copyLink} onRegenerate={() => regenerateMutation.mutate('pre')} />
        <LinkCard label="Post-assessment link" token={cohort.post_link_token} onCopy={copyLink} onRegenerate={() => regenerateMutation.mutate('post')} />
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <Stat label="Total enrolled" value={cohort.total_enrolled} />
        <Stat label="Pre completed" value={`${cohort.pre_completed} (${prePct}%)`} />
        <Stat label="Post completed" value={`${cohort.post_completed} (${postPct}%)`} />
        <Stat label="Missing (not yet post)" value={missing} />
      </div>

      {/* FR-M3-04: equity view lives as a tab within this same dashboard. */}
      <div className="flex gap-4 border-b mb-6">
        {(['overview', 'equity', 'satisfaction', 'reports'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2 text-sm font-medium capitalize border-b-2 -mb-px ${tab === t ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* US-13: compound demographic filters — applying any of them updates
          the Overview tab's stats, competency breakdown, and learner table
          together via the same query. Not applicable to the Reports tab. */}
      {tab !== 'reports' && tab !== 'satisfaction' && (
        <div className="bg-white rounded-lg shadow p-4 mb-6 flex flex-wrap items-end gap-3">
          {FILTER_DIMENSIONS.map((dim) => (
            <label key={dim} className="text-xs text-slate-500">
              {DIMENSION_LABEL[dim]}
              <select
                className="mt-1 block border rounded px-2 py-1.5 text-sm text-slate-700"
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
            <button onClick={clearFilters} className="text-xs text-slate-500 underline pb-1.5">
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

              <div className="bg-white rounded-lg shadow p-5 mb-6">
                <h3 className="font-medium text-slate-900 mb-3">Competency breakdown</h3>
                <div className="space-y-2">
                  {analytics.competency_breakdown.map((area) => (
                    <div key={area.area_id} className="flex items-center justify-between text-sm">
                      <span className="text-slate-700">{area.area_name}</span>
                      <span className="text-slate-500">
                        {area.pre_pct !== null ? `${area.pre_pct}%` : '—'} → {area.post_pct !== null ? `${area.post_pct}%` : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
          {analytics && analytics.n_learners === 0 && hasFilters && (
            <div className="bg-white rounded-lg shadow p-5 mb-6 text-sm text-slate-500">No learners match the selected filters.</div>
          )}

          <div className="flex justify-end mb-2">
            <button onClick={downloadLearnersCsv} className="text-sm border rounded px-3 py-1.5 hover:bg-slate-100">
              Export CSV
            </button>
          </div>

          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="p-3">Learner</th>
                  <th className="p-3">Pre</th>
                  <th className="p-3">Post</th>
                  <th className="p-3">Gain</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredLearners?.map((l) => {
                  const pre = l.pre_score !== null ? Number(l.pre_score) : null;
                  const post = l.post_score !== null ? Number(l.post_score) : null;
                  const gain = pre !== null && post !== null ? Math.round((post - pre) * 100) / 100 : null;
                  return (
                    <tr key={l.learner_id}>
                      <td className="p-3">{l.display_name ?? l.learner_id.slice(0, 8)}</td>
                      <td className="p-3">
                        <StatusBadge status={l.pre_status} score={pre} />
                      </td>
                      <td className="p-3">
                        <StatusBadge status={l.post_status} score={post} />
                      </td>
                      <td className="p-3">{gain !== null ? (gain >= 0 ? '+' : '') + gain : '—'}</td>
                    </tr>
                  );
                })}
                {filteredLearners?.length === 0 && (
                  <tr>
                    <td className="p-3 text-slate-500" colSpan={4}>
                      {hasFilters ? 'No learners match the selected filters.' : 'No learners yet — share the pre-assessment link to get started.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'equity' && (
        <div className="space-y-6">
          {equity?.map((breakdown) => (
            <div key={breakdown.dimension} className="bg-white rounded-lg shadow overflow-hidden">
              <h3 className="font-medium text-slate-900 p-4 pb-0">{DIMENSION_LABEL[breakdown.dimension] ?? breakdown.dimension}</h3>
              <table className="w-full text-sm mt-3">
                <thead className="bg-slate-50 text-left text-slate-500">
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
                          <span className="ml-2 text-xs bg-amber-100 text-amber-800 rounded-full px-2 py-0.5" title="Sample too small — treat with caution">
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
                      <td className="p-3 text-slate-500" colSpan={7}>
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
            <div className="bg-white rounded-lg shadow p-5 text-sm text-slate-500">
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

              <div className="bg-white rounded-lg shadow p-5">
                <h3 className="font-medium text-slate-900 mb-3">Net Promoter Score</h3>
                <div className="flex items-center gap-6">
                  <div>
                    <p className="text-2xl font-semibold text-slate-900">{satisfaction.nps_score !== null ? satisfaction.nps_score : '—'}</p>
                    <p className="text-xs text-slate-500">−100 to +100</p>
                  </div>
                  <div className="flex-1 grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-slate-500">Promoters (9–10)</p>
                      <p className="font-medium text-emerald-700">{satisfaction.nps_promoters}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Passives (7–8)</p>
                      <p className="font-medium text-slate-700">{satisfaction.nps_passives}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Detractors (0–6)</p>
                      <p className="font-medium text-red-700">{satisfaction.nps_detractors}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow p-5">
                <h3 className="font-medium text-slate-900 mb-3">Learner comments</h3>
                <div className="space-y-3">
                  {satisfaction.comments.map((c, i) => (
                    <div key={i} className="text-sm border-b last:border-b-0 pb-3 last:pb-0">
                      {c.positive && (
                        <p className="text-slate-700">
                          <span className="text-emerald-700 font-medium">Liked: </span>
                          {c.positive}
                        </p>
                      )}
                      {c.improve && (
                        <p className="text-slate-700 mt-1">
                          <span className="text-amber-700 font-medium">Could improve: </span>
                          {c.improve}
                        </p>
                      )}
                      <p className="text-xs text-slate-400 mt-1">{new Date(c.created_at).toLocaleDateString()}</p>
                    </div>
                  ))}
                  {satisfaction.comments.length === 0 && <p className="text-sm text-slate-500">No written comments yet.</p>}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'reports' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-5">
            <h3 className="font-medium text-slate-900 mb-3">{editingReportId ? 'Edit narrative & regenerate' : 'Generate a new report'}</h3>
            <div className="space-y-3">
              {!editingReportId && (
                <label className="block text-xs text-slate-500">
                  Funder template
                  <select
                    className="mt-1 block w-full border rounded px-2 py-1.5 text-sm text-slate-700"
                    value={reportTemplate}
                    onChange={(e) => setReportTemplate(e.target.value)}
                  >
                    <option value="">Select a template…</option>
                    {templates?.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block text-xs text-slate-500">
                Background / theory of change
                <textarea
                  className="mt-1 block w-full border rounded px-2 py-1.5 text-sm text-slate-700"
                  rows={2}
                  value={reportForm.background}
                  onChange={(e) => setReportForm({ ...reportForm, background: e.target.value })}
                />
              </label>
              <label className="block text-xs text-slate-500">
                Challenges
                <textarea
                  className="mt-1 block w-full border rounded px-2 py-1.5 text-sm text-slate-700"
                  rows={2}
                  value={reportForm.challenges}
                  onChange={(e) => setReportForm({ ...reportForm, challenges: e.target.value })}
                />
              </label>
              <label className="block text-xs text-slate-500">
                Next steps
                <textarea
                  className="mt-1 block w-full border rounded px-2 py-1.5 text-sm text-slate-700"
                  rows={2}
                  value={reportForm.next_steps}
                  onChange={(e) => setReportForm({ ...reportForm, next_steps: e.target.value })}
                />
              </label>
              <div className="flex gap-2">
                {editingReportId ? (
                  <>
                    <button
                      onClick={() => regenerateReportMutation.mutate(editingReportId)}
                      disabled={regenerateReportMutation.isPending}
                      className="text-sm bg-slate-900 text-white rounded px-3 py-1.5 disabled:opacity-50"
                    >
                      {regenerateReportMutation.isPending ? 'Regenerating…' : 'Save & regenerate'}
                    </button>
                    <button onClick={cancelEditingReport} className="text-sm border rounded px-3 py-1.5">
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => generateReportMutation.mutate()}
                    disabled={!reportTemplate || generateReportMutation.isPending}
                    className="text-sm bg-slate-900 text-white rounded px-3 py-1.5 disabled:opacity-50"
                  >
                    {generateReportMutation.isPending ? 'Generating…' : 'Generate report'}
                  </button>
                )}
              </div>
              {generateReportMutation.isError && <p className="text-xs text-red-600">{(generateReportMutation.error as Error).message}</p>}
              {regenerateReportMutation.isError && <p className="text-xs text-red-600">{(regenerateReportMutation.error as Error).message}</p>}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="p-3">Template</th>
                  <th className="p-3">Generated</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {reports?.map((r) => (
                  <tr key={r.id}>
                    <td className="p-3">{templates?.find((t) => t.key === r.funder_template)?.label ?? r.funder_template}</td>
                    <td className="p-3 text-slate-500">{new Date(r.generated_at).toLocaleString()}</td>
                    <td className="p-3 capitalize">{r.status}</td>
                    <td className="p-3">
                      <div className="flex gap-3">
                        <button onClick={() => downloadReport(r.id, 'pdf')} className="text-xs text-slate-700 underline">
                          PDF
                        </button>
                        <button onClick={() => downloadReport(r.id, 'docx')} className="text-xs text-slate-700 underline">
                          Word
                        </button>
                        <button onClick={() => startEditingReport(r)} className="text-xs text-slate-700 underline">
                          Edit & regenerate
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {reports?.length === 0 && (
                  <tr>
                    <td className="p-3 text-slate-500" colSpan={4}>
                      No reports generated yet for this cohort.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function LinkCard({ label, token, onCopy, onRegenerate }: { label: string; token: string; onCopy: (t: string) => void; onRegenerate: () => void }) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <p className="text-xs font-medium text-slate-500 mb-1">{label}</p>
      <p className="text-xs text-slate-700 truncate mb-2">
        {ASSESSMENT_WEB_ORIGIN}/assess/{token}
      </p>
      <div className="flex gap-2">
        <button onClick={() => onCopy(token)} className="text-xs border rounded px-2 py-1 hover:bg-slate-100">
          Copy link
        </button>
        <button onClick={onRegenerate} className="text-xs text-red-600 hover:underline">
          Regenerate
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function StatusBadge({ status, score }: { status: string; score: number | null }) {
  const color = status === 'completed' ? 'bg-emerald-100 text-emerald-800' : status === 'started' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500';
  return (
    <span className={`text-xs rounded-full px-2 py-1 ${color}`}>
      {status === 'completed' && score !== null ? `${score}%` : status.replace('_', ' ')}
    </span>
  );
}
