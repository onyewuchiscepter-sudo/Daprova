import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api';
import { useAuth } from '../auth';
import { Banner, EmptyState, LinkButton, PageHeader, Stat } from '../components/ui';
import CohortComparison, { type CohortMetrics } from '../components/CohortComparison';

type Overview = {
  totals: {
    cohorts: number;
    active_cohorts: number;
    learners: number;
    pre_completed: number;
    post_completed: number;
    measured_learners: number;
    mean_pre: number | null;
    mean_post: number | null;
    mean_gain: number | null;
    pass_rate: number | null;
    reports: number;
  };
  attention: Array<{ cohort_id: string; cohort_name: string; kind: string; message: string }>;
  cohorts: CohortMetrics[];
  comparison_available: boolean;
  recent_reports: Array<{ id: string; funder_template: string; generated_at: string; cohort_id: string; cohort_name: string }>;
};

const ATTENTION_ACTION: Record<string, string> = {
  post_missing: 'Send reminders',
  report_ready: 'Generate report',
  tracer_due: 'Send follow-up',
  no_learners: 'Get the link',
  locked: 'View cohort',
};

const TEMPLATE_LABEL: Record<string, string> = {
  mastercard_foundation: 'MasterCard Foundation',
  tony_elumelu_foundation: 'Tony Elumelu Foundation',
  giz_usaid: 'GIZ / USAID',
  generic_donor: 'Generic donor',
};

const pct = (v: number | null) => (v === null ? '—' : `${v}%`);

// The first screen after signing in: everything across all cohorts at a
// glance, and the handful of things worth doing today.
export default function HomePage() {
  const { org } = useAuth();
  const { data, isLoading, error } = useQuery<Overview>({ queryKey: ['org-overview'], queryFn: () => apiFetch('/api/v1/org/overview'), refetchInterval: 30000 });

  if (isLoading) return <p className="text-sm text-ink-soft">Loading…</p>;
  if (error) return <Banner tone="flag">{(error as Error).message}</Banner>;
  if (!data) return null;

  const { totals } = data;
  const postRate = totals.pre_completed ? Math.round((totals.post_completed / totals.pre_completed) * 100) : null;

  if (totals.cohorts === 0) {
    return (
      <div>
        <PageHeader title={`Welcome${org?.name ? `, ${org.name}` : ''}`} sub="Measure what your learners gain: a pre-assessment before your programme, a post-assessment after, and funder-ready reports from the difference." />
        <EmptyState action={<LinkButton to="/courses/new">Create your first course</LinkButton>}>
          Start with a course — pick one of the ready-made templates or build your own. Then create a cohort and share its assessment link with learners.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Home" sub={`${org?.name ?? 'Your organisation'} across ${totals.cohorts} cohort${totals.cohorts === 1 ? '' : 's'}.`} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Learners enrolled" value={totals.learners.toLocaleString()} />
        <Stat label="Measured (pre + post)" value={totals.measured_learners.toLocaleString()} />
        <Stat label="Average gain" value={totals.mean_gain === null ? '—' : `${totals.mean_gain >= 0 ? '+' : ''}${totals.mean_gain} pts`} tone="gain" />
        <Stat label="Pass rate" value={pct(totals.pass_rate)} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Active cohorts" value={totals.active_cohorts} tone="sage" />
        <Stat label="Post-assessment completion" value={postRate === null ? '—' : `${postRate}%`} tone="sage" />
        <Stat label="Avg pre → post" value={`${pct(totals.mean_pre)} → ${pct(totals.mean_post)}`} tone="sage" />
        <Stat label="Funder reports" value={totals.reports} tone="sage" />
      </div>

      {data.attention.length > 0 && (
        <div className="bg-paper rounded-lg border border-rule">
          <h2 className="font-display font-semibold text-[18px] tracking-[-0.01em] text-ink px-5 pt-4 pb-2">Needs attention</h2>
          <ul className="divide-y divide-rule">
            {data.attention.map((a, i) => (
              <li key={`${a.cohort_id}-${a.kind}-${i}`} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink truncate">{a.cohort_name}</p>
                  <p className="text-sm text-ink-soft">{a.message}</p>
                </div>
                <Link
                  to={`/cohorts/${a.cohort_id}${a.kind === 'report_ready' ? '?tab=reports' : a.kind === 'post_missing' ? '?remind=post' : a.kind === 'tracer_due' ? '?remind=tracer' : ''}`}
                  className="shrink-0 text-sm border border-rule rounded px-3 py-1.5 hover:border-ink"
                >
                  {ATTENTION_ACTION[a.kind] ?? 'Open'}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-paper rounded-lg border border-rule p-5">
        <h2 className="font-display font-semibold text-[18px] tracking-[-0.01em] text-ink mb-1">Cohorts compared</h2>
        <p className="text-sm text-ink-soft mb-4">Average scores before and after, per cohort, oldest first.</p>
        {data.comparison_available ? (
          <CohortComparison cohorts={data.cohorts} showCourse />
        ) : (
          <p className="text-sm text-ink-soft">
            Comparing results across cohorts over time comes with the Scale plan.{' '}
            <Link to="/billing" className="text-ink underline">
              See plans
            </Link>
          </p>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-paper rounded-lg border border-rule p-5">
          <h2 className="font-display font-semibold text-[18px] tracking-[-0.01em] text-ink mb-3">All cohorts</h2>
          <ul className="divide-y divide-rule">
            {[...data.cohorts].reverse().map((c) => {
              const done = c.pre_completed ? Math.round((c.post_completed / c.pre_completed) * 100) : 0;
              return (
                <li key={c.cohort_id} className="py-2.5">
                  <Link to={`/cohorts/${c.cohort_id}`} className="flex items-center justify-between gap-3 hover:underline">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink truncate">{c.cohort_name}</span>
                      <span className="block text-xs text-sage truncate">{c.course_name}</span>
                    </span>
                    <span className="shrink-0 text-right font-mono text-[11px] text-ink-soft">
                      {c.enrolled} enrolled · {done}% post
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="bg-paper rounded-lg border border-rule p-5">
          <h2 className="font-display font-semibold text-[18px] tracking-[-0.01em] text-ink mb-3">Recent funder reports</h2>
          {data.recent_reports.length === 0 ? (
            <p className="text-sm text-ink-soft">No reports yet. Open a cohort with results and use its Reports tab.</p>
          ) : (
            <ul className="divide-y divide-rule">
              {data.recent_reports.map((r) => (
                <li key={r.id} className="py-2.5">
                  <Link to={`/cohorts/${r.cohort_id}?tab=reports`} className="flex items-center justify-between gap-3 hover:underline">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink truncate">{TEMPLATE_LABEL[r.funder_template] ?? r.funder_template}</span>
                      <span className="block text-xs text-sage truncate">{r.cohort_name}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-ink-soft">{new Date(r.generated_at).toLocaleDateString()}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
