import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { apiFetch } from '../api';

type Cohort = {
  id: string;
  name: string;
  status: string;
  pre_link_token: string;
  post_link_token: string;
  total_enrolled: number;
  pre_completed: number;
  post_completed: number;
};
type LearnerRow = {
  learner_id: string;
  display_name: string | null;
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

// Local dev origin for the learner-facing app. In production this would be
// the real app.daprova.com/assess/{token} host from the spec (US-06).
const ASSESSMENT_WEB_ORIGIN = 'http://localhost:5174';

export default function CohortDashboardPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

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
  // US-11: mean pre/post/gain, pass rate, and competency breakdown for the
  // full cohort dashboard — separate from the completion-count stats above,
  // which come from the lighter-weight /cohorts/:id endpoint.
  const { data: analytics } = useQuery<DashboardAnalytics>({
    queryKey: ['cohort-dashboard', id],
    queryFn: () => apiFetch(`/api/v1/cohorts/${id}/dashboard`),
    refetchInterval: 5000,
  });

  const regenerateMutation = useMutation({
    mutationFn: (type: 'pre' | 'post') =>
      apiFetch(`/api/v1/cohorts/${id}/regenerate-link`, { method: 'POST', body: JSON.stringify({ type }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cohort', id] }),
  });

  function copyLink(token: string) {
    navigator.clipboard.writeText(`${ASSESSMENT_WEB_ORIGIN}/assess/${token}`);
  }

  if (!cohort) return <p className="text-slate-500">Loading…</p>;

  const prePct = cohort.total_enrolled > 0 ? Math.round((cohort.pre_completed / cohort.total_enrolled) * 100) : 0;
  const postPct = cohort.total_enrolled > 0 ? Math.round((cohort.post_completed / cohort.total_enrolled) * 100) : 0;
  const missing = cohort.total_enrolled - cohort.post_completed;

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900 mb-1">{cohort.name}</h1>
      <p className="text-sm text-slate-500 mb-6 capitalize">{cohort.status}</p>

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
            {learners?.map((l) => {
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
            {learners?.length === 0 && (
              <tr>
                <td className="p-3 text-slate-500" colSpan={4}>
                  No learners yet — share the pre-assessment link to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
