import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api';

type Course = { id: string; name: string; category: string; created_at: string };

export default function CoursesListPage() {
  const { data, isLoading, error } = useQuery<Course[]>({
    queryKey: ['courses'],
    queryFn: () => apiFetch('/api/v1/courses'),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold text-slate-900">Courses</h1>
        <Link to="/courses/new" className="bg-slate-900 text-white text-sm rounded px-4 py-2">
          + New Course
        </Link>
      </div>

      {isLoading && <p className="text-slate-500">Loading…</p>}
      {error && <p className="text-red-600">{(error as Error).message}</p>}
      {data && data.length === 0 && (
        <div className="bg-white rounded-lg shadow p-8 text-center text-slate-500">No courses yet.</div>
      )}

      <ul className="space-y-2">
        {data?.map((c) => (
          <li key={c.id}>
            <Link to={`/courses/${c.id}`} className="block bg-white rounded-lg shadow p-4 hover:shadow-md transition-shadow">
              <p className="font-medium text-slate-900">{c.name}</p>
              <p className="text-xs text-slate-500">{c.category}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
