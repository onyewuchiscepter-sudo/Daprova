import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api';
import { Banner, EmptyState, LinkButton, PageHeader } from '../components/ui';

type Framework = {
  id: string;
  name: string;
  category: string;
  version: number;
  created_at: string;
};

export default function FrameworksListPage() {
  const { data, isLoading, error } = useQuery<Framework[]>({
    queryKey: ['frameworks'],
    queryFn: () => apiFetch('/api/v1/frameworks'),
  });

  return (
    <div>
      <PageHeader
        title="Frameworks"
        sub="A framework groups related courses. Creating a course creates its framework automatically."
        actions={
          <>
            <LinkButton to="/frameworks/import" variant="secondary">
              Import template
            </LinkButton>
            <LinkButton to="/courses/new">New course</LinkButton>
          </>
        }
      />

      {isLoading && <p className="text-sm text-ink-soft">Loading…</p>}
      {error && <Banner tone="flag">{(error as Error).message}</Banner>}

      {data && data.length === 0 && (
        <EmptyState action={<LinkButton to="/courses/new">Create a course</LinkButton>}>
          No frameworks yet. Creating a course — from a template or from scratch — sets one up for you.
        </EmptyState>
      )}

      <ul className="space-y-2">
        {data?.map((f) => (
          <li key={f.id}>
            <Link
              to={`/frameworks/${f.id}`}
              className="block bg-paper border border-rule rounded-lg px-4 py-3.5 hover:border-ink transition-colors"
            >
              <p className="font-medium text-ink">{f.name}</p>
              <p className="font-mono text-[11px] text-sage mt-0.5">
                {f.category} · v{f.version}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
