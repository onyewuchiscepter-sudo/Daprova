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
