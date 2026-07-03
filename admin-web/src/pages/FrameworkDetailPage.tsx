import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../api';

type Question = {
  id: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: string;
  assessment_type: string;
  is_active: boolean;
};
type Area = { id: string; name: string; is_active: boolean; active_question_warning: boolean; questions: Question[] };
type FrameworkDetail = { id: string; name: string; category: string; version: number; is_locked: boolean; areas: Area[] };

export default function FrameworkDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [newAreaName, setNewAreaName] = useState('');
  const [confirmDeactivate, setConfirmDeactivate] = useState<string | null>(null);

  const { data: framework, isLoading, error } = useQuery<FrameworkDetail>({
    queryKey: ['framework', id],
    queryFn: () => apiFetch(`/api/v1/frameworks/${id}`),
  });

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: ['framework', id] });
  }

  const addAreaMutation = useMutation({
    mutationFn: (name: string) => apiFetch(`/api/v1/frameworks/${id}/areas`, { method: 'POST', body: JSON.stringify({ name }) }),
    onSuccess: () => {
      setNewAreaName('');
      return invalidate();
    },
  });

  const deactivateAreaMutation = useMutation({
    mutationFn: (areaId: string) => apiFetch(`/api/v1/frameworks/${id}/areas/${areaId}`, { method: 'DELETE' }),
    onSuccess: () => {
      setConfirmDeactivate(null);
      return invalidate();
    },
  });

  const toggleQuestionMutation = useMutation({
    mutationFn: ({ questionId, isActive }: { questionId: string; isActive: boolean }) =>
      apiFetch(`/api/v1/frameworks/${id}/questions/${questionId}`, { method: 'PATCH', body: JSON.stringify({ is_active: isActive }) }),
    onSuccess: invalidate,
  });

  const cloneMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/frameworks/${id}/clone`, { method: 'POST', body: JSON.stringify({}) }),
    onSuccess: async (cloned) => {
      await queryClient.invalidateQueries({ queryKey: ['frameworks'] });
      navigate(`/frameworks/${cloned.id}`);
    },
  });

  if (isLoading) return <p className="text-slate-500">Loading…</p>;
  if (error) return <p className="text-red-600">{(error as Error).message}</p>;
  if (!framework) return null;

  const activeAreas = framework.areas.filter((a) => a.is_active);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-semibold text-slate-900">{framework.name}</h1>
        <div className="flex items-center gap-2">
          {framework.is_locked && <span className="text-xs bg-amber-100 text-amber-800 rounded-full px-2 py-1">Locked</span>}
          <button
            onClick={() => cloneMutation.mutate()}
            disabled={cloneMutation.isPending}
            className="text-sm border rounded px-3 py-1.5 hover:bg-slate-100"
          >
            Clone
          </button>
        </div>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        {framework.category} · v{framework.version}
      </p>

      {framework.is_locked && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg p-3 mb-6">
          This framework is locked because a cohort has started assessments against it. Clone it to make changes.
        </div>
      )}

      <div className="space-y-4">
        {framework.areas.map((area) => (
          <div key={area.id} className={`bg-white rounded-lg shadow p-5 ${!area.is_active ? 'opacity-50' : ''}`}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="font-medium text-slate-900">{area.name}</h2>
                <p className="text-xs text-slate-500">
                  {area.questions.filter((q) => q.is_active).length} of {area.questions.length} questions active
                </p>
              </div>
              {area.is_active && !framework.is_locked && (
                <div>
                  {confirmDeactivate === area.id ? (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-slate-600">Deactivate this area?</span>
                      <button
                        onClick={() => deactivateAreaMutation.mutate(area.id)}
                        className="text-red-600 underline"
                      >
                        Confirm
                      </button>
                      <button onClick={() => setConfirmDeactivate(null)} className="text-slate-500 underline">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeactivate(area.id)}
                      disabled={activeAreas.length <= 1}
                      title={activeAreas.length <= 1 ? 'At least one active area is required' : ''}
                      className="text-sm text-red-600 hover:underline disabled:text-slate-300 disabled:no-underline"
                    >
                      Deactivate area
                    </button>
                  )}
                </div>
              )}
            </div>

            {area.active_question_warning && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded p-2 mb-3">
                Fewer than 8 active questions remain in this area.
              </div>
            )}

            <ul className="divide-y">
              {area.questions.map((q) => (
                <li key={q.id} className="py-2 flex items-start justify-between gap-4">
                  <div className="text-sm text-slate-700">
                    <span className={!q.is_active ? 'line-through text-slate-400' : ''}>{q.question_text}</span>
                    <span className="ml-2 text-xs text-slate-400">({q.assessment_type})</span>
                  </div>
                  {!framework.is_locked && (
                    <label className="flex items-center gap-1.5 text-xs text-slate-500 shrink-0">
                      <input
                        type="checkbox"
                        checked={q.is_active}
                        onChange={(e) => toggleQuestionMutation.mutate({ questionId: q.id, isActive: e.target.checked })}
                      />
                      Active
                    </label>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {!framework.is_locked && (
        <div className="mt-6 bg-white rounded-lg shadow p-5">
          <h3 className="font-medium text-slate-900 mb-2">Add competency area</h3>
          <div className="flex gap-2">
            <input
              className="flex-1 border rounded px-3 py-2 text-sm"
              placeholder="e.g. Excel Fundamentals"
              value={newAreaName}
              onChange={(e) => setNewAreaName(e.target.value)}
            />
            <button
              onClick={() => addAreaMutation.mutate(newAreaName)}
              disabled={!newAreaName || addAreaMutation.isPending}
              className="bg-slate-900 text-white text-sm rounded px-4 py-2 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
