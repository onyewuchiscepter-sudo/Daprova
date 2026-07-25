import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { apiFetch } from '../api';

type Course = { id: string; name: string; category: string; is_locked: boolean; created_at: string };
type FrameworkDetail = { id: string; name: string; category: string; version: number; courses: Course[] };

// A framework's own page is just its name/category and the list of Courses
// under it — each course owns its own competency areas/questions (see
// CourseDetailPage), so there's no area editor here anymore.
export default function FrameworkDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState('');

  const { data: framework, isLoading, error } = useQuery<FrameworkDetail>({
    queryKey: ['framework', id],
    queryFn: () => apiFetch(`/api/v1/frameworks/${id}`),
  });

  const renameMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/frameworks/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
    onSuccess: () => {
      setEditingName(false);
      return queryClient.invalidateQueries({ queryKey: ['framework', id] });
    },
  });

  if (isLoading) return <p className="text-slate-500">Loading…</p>;
  if (error) return <p className="text-red-600">{(error as Error).message}</p>;
  if (!framework) return null;

  return (
    <div>
      {editingName ? (
        <div className="flex items-center gap-2 mb-1">
          <input className="border rounded px-2 py-1 text-lg font-semibold" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <button onClick={() => renameMutation.mutate()} disabled={!name || renameMutation.isPending} className="text-sm text-slate-700 underline">
            Save
          </button>
          <button onClick={() => setEditingName(false)} className="text-sm text-slate-500 underline">
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-lg font-semibold text-slate-900">{framework.name}</h1>
          <button
            onClick={() => {
              setName(framework.name);
              setEditingName(true);
            }}
            className="text-xs text-slate-500 hover:underline"
          >
            Rename
          </button>
        </div>
      )}
      <p className="text-sm text-slate-500 mb-6">
        {framework.category} · v{framework.version}
      </p>

      <div className="flex items-center justify-between mb-3">
        <h2 className="font-medium text-slate-900">Courses</h2>
        <Link to={`/courses/new?frameworkId=${framework.id}`} className="text-sm bg-slate-900 text-white rounded px-3 py-1.5">
          + Add course
        </Link>
      </div>

      <ul className="space-y-2">
        {framework.courses.map((c) => (
          <li key={c.id}>
            <Link to={`/courses/${c.id}`} className="block bg-white rounded-lg shadow p-4 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-900">{c.name}</p>
                  <p className="text-xs text-slate-500">{c.category}</p>
                </div>
                {c.is_locked && <span className="text-xs bg-amber-100 text-amber-800 rounded-full px-2 py-1">Locked</span>}
              </div>
            </Link>
          </li>
        ))}
        {framework.courses.length === 0 && (
          <li className="bg-white rounded-lg shadow p-8 text-center text-slate-500">No courses under this framework yet.</li>
        )}
      </ul>
    </div>
  );
}
