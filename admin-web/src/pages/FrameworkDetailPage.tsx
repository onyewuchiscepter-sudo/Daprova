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

type QuestionFormValues = {
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: 'a' | 'b' | 'c' | 'd';
  assessment_type: 'pre' | 'post' | 'both';
};

const EMPTY_QUESTION_FORM: QuestionFormValues = {
  question_text: '',
  option_a: '',
  option_b: '',
  option_c: '',
  option_d: '',
  correct_option: 'a',
  assessment_type: 'both',
};

export default function FrameworkDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [newAreaName, setNewAreaName] = useState('');
  const [confirmDeactivate, setConfirmDeactivate] = useState<string | null>(null);
  const [addingQuestionForArea, setAddingQuestionForArea] = useState<string | null>(null);
  const [newQuestion, setNewQuestion] = useState<QuestionFormValues>(EMPTY_QUESTION_FORM);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [editQuestion, setEditQuestion] = useState<QuestionFormValues>(EMPTY_QUESTION_FORM);

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

  const addQuestionMutation = useMutation({
    mutationFn: ({ areaId, values }: { areaId: string; values: QuestionFormValues }) =>
      apiFetch(`/api/v1/frameworks/${id}/areas/${areaId}/questions`, { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: () => {
      setAddingQuestionForArea(null);
      setNewQuestion(EMPTY_QUESTION_FORM);
      return invalidate();
    },
  });

  const editQuestionMutation = useMutation({
    mutationFn: ({ questionId, values }: { questionId: string; values: QuestionFormValues }) =>
      apiFetch(`/api/v1/frameworks/${id}/questions/${questionId}`, { method: 'PATCH', body: JSON.stringify(values) }),
    onSuccess: () => {
      setEditingQuestionId(null);
      return invalidate();
    },
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
  const questionFormValid = (v: QuestionFormValues) => Boolean(v.question_text && v.option_a && v.option_b && v.option_c && v.option_d);

  function startEdit(q: Question) {
    setEditingQuestionId(q.id);
    setEditQuestion({
      question_text: q.question_text,
      option_a: q.option_a,
      option_b: q.option_b,
      option_c: q.option_c,
      option_d: q.option_d,
      correct_option: q.correct_option as 'a' | 'b' | 'c' | 'd',
      assessment_type: q.assessment_type as 'pre' | 'post' | 'both',
    });
  }

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
                <li key={q.id} className="py-2">
                  {editingQuestionId === q.id ? (
                    <QuestionForm
                      values={editQuestion}
                      onChange={setEditQuestion}
                      onSubmit={() => editQuestionMutation.mutate({ questionId: q.id, values: editQuestion })}
                      onCancel={() => setEditingQuestionId(null)}
                      submitting={editQuestionMutation.isPending}
                      submitLabel="Save"
                      valid={questionFormValid(editQuestion)}
                    />
                  ) : (
                    <div className="flex items-start justify-between gap-4">
                      <div className="text-sm text-slate-700">
                        <span className={!q.is_active ? 'line-through text-slate-400' : ''}>{q.question_text}</span>
                        <span className="ml-2 text-xs text-slate-400">({q.assessment_type})</span>
                      </div>
                      {!framework.is_locked && (
                        <div className="flex items-center gap-3 shrink-0">
                          <button onClick={() => startEdit(q)} className="text-xs text-slate-500 hover:underline">
                            Edit
                          </button>
                          <label className="flex items-center gap-1.5 text-xs text-slate-500">
                            <input
                              type="checkbox"
                              checked={q.is_active}
                              onChange={(e) => toggleQuestionMutation.mutate({ questionId: q.id, isActive: e.target.checked })}
                            />
                            Active
                          </label>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>

            {!framework.is_locked && area.is_active && (
              <div className="mt-3 pt-3 border-t">
                {addingQuestionForArea === area.id ? (
                  <QuestionForm
                    values={newQuestion}
                    onChange={setNewQuestion}
                    onSubmit={() => addQuestionMutation.mutate({ areaId: area.id, values: newQuestion })}
                    onCancel={() => setAddingQuestionForArea(null)}
                    submitting={addQuestionMutation.isPending}
                    submitLabel="Add question"
                    valid={questionFormValid(newQuestion)}
                  />
                ) : (
                  <button
                    onClick={() => {
                      setAddingQuestionForArea(area.id);
                      setNewQuestion(EMPTY_QUESTION_FORM);
                    }}
                    className="text-sm text-slate-700 hover:underline"
                  >
                    + Add question
                  </button>
                )}
              </div>
            )}
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

function QuestionForm(props: {
  values: QuestionFormValues;
  onChange: (v: QuestionFormValues) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitting: boolean;
  submitLabel: string;
  valid: boolean;
}) {
  const { values, onChange, onSubmit, onCancel, submitting, submitLabel, valid } = props;
  const options: Array<{ key: 'option_a' | 'option_b' | 'option_c' | 'option_d'; letter: 'a' | 'b' | 'c' | 'd' }> = [
    { key: 'option_a', letter: 'a' },
    { key: 'option_b', letter: 'b' },
    { key: 'option_c', letter: 'c' },
    { key: 'option_d', letter: 'd' },
  ];

  return (
    <div className="bg-slate-50 rounded p-3 space-y-2">
      <input
        className="w-full border rounded px-2 py-1.5 text-sm"
        placeholder="Question text"
        value={values.question_text}
        onChange={(e) => onChange({ ...values, question_text: e.target.value })}
      />
      {options.map((o) => (
        <div key={o.key} className="flex items-center gap-2">
          <input
            type="radio"
            name="correct_option"
            checked={values.correct_option === o.letter}
            onChange={() => onChange({ ...values, correct_option: o.letter })}
            title="Mark as correct answer"
          />
          <input
            className="flex-1 border rounded px-2 py-1.5 text-sm"
            placeholder={`Option ${o.letter.toUpperCase()}`}
            value={values[o.key]}
            onChange={(e) => onChange({ ...values, [o.key]: e.target.value })}
          />
        </div>
      ))}
      <div className="flex items-center justify-between">
        <label className="text-xs text-slate-500 flex items-center gap-2">
          Used for
          <select
            className="border rounded px-2 py-1 text-xs"
            value={values.assessment_type}
            onChange={(e) => onChange({ ...values, assessment_type: e.target.value as QuestionFormValues['assessment_type'] })}
          >
            <option value="both">Pre and post</option>
            <option value="pre">Pre only</option>
            <option value="post">Post only</option>
          </select>
        </label>
        <div className="flex gap-3">
          <button onClick={onCancel} className="text-xs text-slate-500 hover:underline">
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={!valid || submitting}
            className="bg-slate-900 text-white text-xs rounded px-3 py-1.5 disabled:opacity-50"
          >
            {submitting ? 'Saving…' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
