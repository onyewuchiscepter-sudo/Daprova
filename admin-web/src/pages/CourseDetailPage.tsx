import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { apiFetch } from '../api';

type Course = { id: string; name: string; category: string };
type Cohort = { id: string; name: string; status: string; created_at: string };
type Framework = { id: string; name: string; category: string };

export default function CourseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [cohortName, setCohortName] = useState('');
  const [frameworkId, setFrameworkId] = useState('');

  const { data: course } = useQuery<Course>({ queryKey: ['course', id], queryFn: () => apiFetch(`/api/v1/courses/${id}`) });
  const { data: cohorts } = useQuery<Cohort[]>({
    queryKey: ['cohorts', id],
    queryFn: () => apiFetch(`/api/v1/courses/${id}/cohorts`),
  });
  const { data: frameworks } = useQuery<Framework[]>({ queryKey: ['frameworks'], queryFn: () => apiFetch('/api/v1/frameworks') });

  const createCohortMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/courses/${id}/cohorts`, { method: 'POST', body: JSON.stringify({ name: cohortName, framework_id: frameworkId }) }),
    onSuccess: () => {
      setCohortName('');
      return queryClient.invalidateQueries({ queryKey: ['cohorts', id] });
    },
  });

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900 mb-1">{course?.name}</h1>
      <p className="text-sm text-slate-500 mb-6">{course?.category}</p>

      <h2 className="font-medium text-slate-900 mb-2">Cohorts</h2>
      <ul className="space-y-2 mb-6">
        {cohorts?.map((c) => (
          <li key={c.id}>
            <Link to={`/cohorts/${c.id}`} className="block bg-white rounded-lg shadow p-4 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-900">{c.name}</span>
                <span className="text-xs bg-slate-100 rounded-full px-2 py-1 capitalize">{c.status}</span>
              </div>
            </Link>
          </li>
        ))}
        {cohorts?.length === 0 && <li className="text-slate-500 text-sm">No cohorts yet.</li>}
      </ul>

      <div className="bg-white rounded-lg shadow p-5">
        <h3 className="font-medium text-slate-900 mb-3">Create cohort</h3>
        <div className="space-y-3">
          <input
            className="w-full border rounded px-3 py-2 text-sm"
            placeholder="Cohort name, e.g. Cohort 1 - Jan 2026"
            value={cohortName}
            onChange={(e) => setCohortName(e.target.value)}
          />
          <select className="w-full border rounded px-3 py-2 text-sm" value={frameworkId} onChange={(e) => setFrameworkId(e.target.value)}>
            <option value="">Select competency framework…</option>
            {frameworks?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          {createCohortMutation.isError && <p className="text-sm text-red-600">{(createCohortMutation.error as Error).message}</p>}
          <button
            onClick={() => createCohortMutation.mutate()}
            disabled={!cohortName || !frameworkId || createCohortMutation.isPending}
            className="bg-slate-900 text-white text-sm rounded px-4 py-2 disabled:opacity-50"
          >
            {createCohortMutation.isPending ? 'Creating…' : 'Create cohort'}
          </button>
        </div>
      </div>
    </div>
  );
}
