import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api';
import { Badge, Banner, EmptyState, LinkButton, PageHeader } from '../components/ui';

type Course = { id: string; name: string; category: string; is_locked: boolean; created_at: string };

export default function CoursesListPage() {
  const { data, isLoading, error } = useQuery<Course[]>({
    queryKey: ['courses'],
    queryFn: () => apiFetch('/api/v1/courses'),
  });

  return (
    <div>
      <PageHeader
        title="Courses"
        sub="Each course holds its own competency areas, questions, and cohorts."
        actions={<LinkButton to="/courses/new">New course</LinkButton>}
      />

      {isLoading && <p className="text-sm text-ink-soft">Loading…</p>}
      {error && <Banner tone="flag">{(error as Error).message}</Banner>}

      {data && data.length === 0 && (
        <EmptyState action={<LinkButton to="/courses/new">Create your first course</LinkButton>}>
          No courses yet. Start from a template or build one from scratch.
        </EmptyState>
      )}

      <ul className="space-y-2">
        {data?.map((c) => (
          <li key={c.id}>
            <Link
              to={`/courses/${c.id}`}
              className="flex items-center justify-between gap-4 bg-paper border border-rule rounded-lg px-4 py-3.5 hover:border-ink transition-colors"
            >
              <div className="min-w-0">
                <p className="font-medium text-ink truncate">{c.name}</p>
                <p className="font-mono text-[11px] text-sage mt-0.5">{c.category}</p>
              </div>
              {c.is_locked && <Badge tone="amber">Locked</Badge>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
