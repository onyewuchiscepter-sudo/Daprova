import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api';
import { Banner, EmptyState, LinkButton, PageHeader } from '../components/ui';

type CohortRow = { id: string; name: string; status: string; created_at: string; course_id: string; course_name: string };

// Every cohort across all courses. Cohorts are still created from a course's
// page (a cohort always belongs to one course), so this is a way in, not a
// second place to create them.
export default function CohortsListPage() {
  const { data, isLoading, error } = useQuery<CohortRow[]>({
    queryKey: ['cohorts'],
    queryFn: () => apiFetch('/api/v1/cohorts'),
  });

  return (
    <div>
      <PageHeader
        title="Cohorts"
        sub="Assessment links, results, equity breakdowns, satisfaction and funder reports live on each cohort."
      />

      {isLoading && <p className="text-sm text-ink-soft">Loading…</p>}
      {error && <Banner tone="flag">{(error as Error).message}</Banner>}

      {data && data.length === 0 && (
        <EmptyState action={<LinkButton to="/courses">Go to courses</LinkButton>}>
          No cohorts yet. Open a course and create a cohort from its page.
        </EmptyState>
      )}

      <ul className="space-y-2">
        {data?.map((c) => (
          <li key={c.id}>
            <Link
              to={`/cohorts/${c.id}`}
              className="flex items-center justify-between gap-4 bg-paper border border-rule rounded-lg px-4 py-3.5 hover:border-ink transition-colors"
            >
              <div className="min-w-0">
                <p className="font-medium text-ink truncate">{c.name}</p>
                <p className="font-mono text-[11px] text-sage mt-0.5 truncate">{c.course_name}</p>
              </div>
              <span className="text-xs bg-ground rounded px-2 py-1 capitalize shrink-0">{c.status}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
