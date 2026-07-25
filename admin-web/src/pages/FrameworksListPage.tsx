import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api';

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
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold text-slate-900">Competency Frameworks</h1>
        <div className="flex items-center gap-2">
          <Link to="/frameworks/import" className="text-sm border rounded px-4 py-2 hover:bg-slate-100">
            Import template
          </Link>
          <Link to="/courses/new" className="bg-slate-900 text-white text-sm rounded px-4 py-2">
            + New Course
          </Link>
        </div>
      </div>

      {isLoading && <p className="text-slate-500">Loading…</p>}
      {error && <p className="text-red-600">{(error as Error).message}</p>}

      {data && data.length === 0 && (
        <div className="bg-white rounded-lg shadow p-8 text-center text-slate-500">
          No frameworks yet — creating a course (from a template or from scratch) creates its framework automatically.
        </div>
      )}

      <ul className="space-y-2">
        {data?.map((f) => (
          <li key={f.id}>
            <Link to={`/frameworks/${f.id}`} className="block bg-white rounded-lg shadow p-4 hover:shadow-md transition-shadow">
              <p className="font-medium text-slate-900">{f.name}</p>
              <p className="text-xs text-slate-500">
                {f.category} · v{f.version}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
