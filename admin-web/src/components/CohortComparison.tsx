import { Link } from 'react-router-dom';

export type CohortMetrics = {
  cohort_id: string;
  cohort_name: string;
  course_id: string;
  course_name: string;
  status: string;
  created_at: string;
  start_date: string | null;
  enrolled: number;
  pre_completed: number;
  post_completed: number;
  pairs: number;
  mean_pre: number | null;
  mean_post: number | null;
  mean_gain: number | null;
  pass_rate: number | null;
  reports: number;
  satisfaction_responses: number;
  tracer_responses: number;
};

const fmtPct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 10) / 10}%`);
const fmtGain = (v: number | null) => (v === null ? '—' : `${v >= 0 ? '+' : ''}${Math.round(v * 10) / 10}`);

// Cohorts side by side: for each, the average pre score (pale bar) and post
// score (green bar) on the same 0-100 track, plus gain and pass rate. Oldest
// first, so improvement over time reads top to bottom.
export default function CohortComparison({ cohorts, showCourse = false }: { cohorts: CohortMetrics[]; showCourse?: boolean }) {
  const measured = cohorts.filter((c) => c.pairs > 0);
  if (measured.length === 0) {
    return <p className="text-sm text-ink-soft">No cohort has pre- and post-assessment results yet. Comparisons appear once learners complete both.</p>;
  }
  // Only cohorts with enough learners to mean something compete for "top gain".
  const eligible = measured.filter((c) => c.pairs >= 5);
  const best = eligible.length > 1 ? eligible.reduce((a, b) => ((b.mean_gain ?? -Infinity) > (a.mean_gain ?? -Infinity) ? b : a)) : null;

  return (
    <div>
      <div className="flex items-center gap-4 text-xs text-ink-soft mb-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-2 rounded-sm bg-rule" /> Mean pre score
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-2 rounded-sm bg-gain" /> Mean post score
        </span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-ink-soft">
            <th className="py-2 pr-3 font-medium">Cohort</th>
            <th className="py-2 pr-3 font-medium w-[40%]">Pre → post</th>
            <th className="py-2 pr-3 font-medium text-right">Gain</th>
            <th className="py-2 pr-3 font-medium text-right">Pass rate</th>
            <th className="py-2 font-medium text-right">Measured</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {measured.map((c) => (
            <tr key={c.cohort_id}>
              <td className="py-2.5 pr-3 align-top">
                <Link to={`/cohorts/${c.cohort_id}`} className="text-ink hover:underline font-medium">
                  {c.cohort_name}
                </Link>
                {best && c.cohort_id === best.cohort_id && (
                  <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.1em] text-gain">Top gain</span>
                )}
                {showCourse && <div className="text-xs text-sage">{c.course_name}</div>}
              </td>
              <td className="py-2.5 pr-3 align-middle">
                <div
                  className="relative h-5 bg-ground rounded-sm overflow-hidden"
                  role="img"
                  aria-label={`Pre ${fmtPct(c.mean_pre)}, post ${fmtPct(c.mean_post)}`}
                >
                  <div className="absolute inset-y-0 left-0 bg-rule" style={{ width: `${Math.min(100, c.mean_pre ?? 0)}%` }} />
                  <div className="absolute left-0 bottom-0 h-2 bg-gain" style={{ width: `${Math.min(100, c.mean_post ?? 0)}%` }} />
                </div>
                <div className="flex justify-between font-mono text-[11px] text-sage mt-0.5">
                  <span>{fmtPct(c.mean_pre)}</span>
                  <span>{fmtPct(c.mean_post)}</span>
                </div>
              </td>
              <td className={`py-2.5 pr-3 text-right font-mono ${(c.mean_gain ?? 0) >= 0 ? 'text-gain' : 'text-flag'}`}>{fmtGain(c.mean_gain)}</td>
              <td className="py-2.5 pr-3 text-right font-mono">{fmtPct(c.pass_rate)}</td>
              <td className="py-2.5 text-right font-mono text-ink-soft">{c.pairs}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
