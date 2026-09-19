import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiFetch, ApiError } from '../api';
import { EMPTY_QUESTION_FORM, QUESTION_TYPE_LABEL, QuestionForm, questionPayload, type QuestionFormValues, type QuestionType } from '../components/QuestionForm';
import QuestionBankModal from '../components/QuestionBankModal';
import CohortComparison, { type CohortMetrics } from '../components/CohortComparison';

type Question = {
  id: string;
  question_type: QuestionType;
  question_text: string;
  scenario_text: string | null;
  option_a: string;
  option_b: string;
  option_c: string | null;
  option_d: string | null;
  correct_option: string | null;
  assessment_type: string;
  is_active: boolean;
};
type Area = { id: string; name: string; is_active: boolean; active_question_warning: boolean; questions: Question[] };
type CourseDetail = {
  id: string;
  name: string;
  category: string;
  is_locked: boolean;
  framework: { id: string; name: string; category: string };
  areas: Area[];
};
type Cohort = { id: string; name: string; status: string; created_at: string };

export default function CourseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [newAreaName, setNewAreaName] = useState('');
  const [confirmDeactivate, setConfirmDeactivate] = useState<string | null>(null);
  const [addingQuestionForArea, setAddingQuestionForArea] = useState<string | null>(null);
  const [newQuestion, setNewQuestion] = useState<QuestionFormValues>(EMPTY_QUESTION_FORM);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [editQuestion, setEditQuestion] = useState<QuestionFormValues>(EMPTY_QUESTION_FORM);
  const [bulkUploadAreaId, setBulkUploadAreaId] = useState<string | null>(null);
  const [bulkErrors, setBulkErrors] = useState<string[] | null>(null);
  const [cohortName, setCohortName] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [courseName, setCourseName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [bankArea, setBankArea] = useState<{ id: string; name: string } | null>(null);
  const [bankNotice, setBankNotice] = useState<string | null>(null);

  const { data: course, isLoading, error } = useQuery<CourseDetail>({
    queryKey: ['course', id],
    queryFn: () => apiFetch(`/api/v1/courses/${id}`),
  });
  const { data: cohorts } = useQuery<Cohort[]>({
    queryKey: ['cohorts', id],
    queryFn: () => apiFetch(`/api/v1/courses/${id}/cohorts`),
  });
  const { data: comparison, error: comparisonError } = useQuery<{ cohorts: CohortMetrics[] }>({
    queryKey: ['course-comparison', id],
    queryFn: () => apiFetch(`/api/v1/courses/${id}/comparison`),
    retry: false,
  });
  const comparisonLocked = comparisonError instanceof ApiError && comparisonError.code === 'UPGRADE_REQUIRED';

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: ['course', id] });
  }

  const addAreaMutation = useMutation({
    mutationFn: (name: string) => apiFetch(`/api/v1/courses/${id}/areas`, { method: 'POST', body: JSON.stringify({ name }) }),
    onSuccess: () => {
      setNewAreaName('');
      return invalidate();
    },
  });

  const deactivateAreaMutation = useMutation({
    mutationFn: (areaId: string) => apiFetch(`/api/v1/courses/${id}/areas/${areaId}`, { method: 'DELETE' }),
    onSuccess: () => {
      setConfirmDeactivate(null);
      return invalidate();
    },
  });

  const toggleQuestionMutation = useMutation({
    mutationFn: ({ questionId, isActive }: { questionId: string; isActive: boolean }) =>
      apiFetch(`/api/v1/courses/${id}/questions/${questionId}`, { method: 'PATCH', body: JSON.stringify({ is_active: isActive }) }),
    onSuccess: invalidate,
  });

  const addQuestionMutation = useMutation({
    mutationFn: ({ areaId, values }: { areaId: string; values: QuestionFormValues }) =>
      apiFetch(`/api/v1/courses/${id}/areas/${areaId}/questions`, { method: 'POST', body: JSON.stringify(questionPayload(values)) }),
    onSuccess: () => {
      setAddingQuestionForArea(null);
      setNewQuestion(EMPTY_QUESTION_FORM);
      return invalidate();
    },
  });

  const editQuestionMutation = useMutation({
    mutationFn: ({ questionId, values }: { questionId: string; values: QuestionFormValues }) =>
      apiFetch(`/api/v1/courses/${id}/questions/${questionId}`, { method: 'PATCH', body: JSON.stringify(questionPayload(values)) }),
    onSuccess: () => {
      setEditingQuestionId(null);
      return invalidate();
    },
  });

  const bulkUploadMutation = useMutation({
    mutationFn: ({ areaId, csv }: { areaId: string; csv: string }) =>
      apiFetch(`/api/v1/courses/${id}/areas/${areaId}/questions/bulk`, { method: 'POST', body: JSON.stringify({ csv }) }),
    onSuccess: () => {
      setBulkUploadAreaId(null);
      setBulkErrors(null);
      return invalidate();
    },
    onError: (err: unknown) => {
      const details = err instanceof ApiError ? (err.details as { errors?: string[] } | undefined) : undefined;
      setBulkErrors(details?.errors ?? [err instanceof Error ? err.message : 'Upload failed']);
    },
  });

  function downloadQuestionsCsvTemplate() {
    const csv =
      'question_type,question_text,scenario_text,option_a,option_b,option_c,option_d,correct_option,assessment_type\r\n' +
      'mcq,What is 2+2?,,3,4,5,6,b,both\r\n' +
      'true_false,Excel files usually end in .xlsx,,True,False,,,a,both\r\n' +
      'scenario,What should Ada use?,Ada has 200 rows of sales and wants a total per month.,A pivot table,Bold text,Merge cells,Freeze panes,a,both\r\n' +
      'self_rating,How confident are you building a budget in a spreadsheet?,,Not confident,Very confident,,,,both\r\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'questions-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleBulkFileSelect(areaId: string, file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      setBulkErrors(null);
      bulkUploadMutation.mutate({ areaId, csv: String(reader.result) });
    };
    reader.readAsText(file);
  }

  const cloneMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/courses/${id}/clone`, { method: 'POST', body: JSON.stringify({}) }),
    onSuccess: async (cloned) => {
      await queryClient.invalidateQueries({ queryKey: ['courses'] });
      navigate(`/courses/${cloned.id}`);
    },
  });

  const renameMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/courses/${id}`, { method: 'PATCH', body: JSON.stringify({ name: courseName }) }),
    onSuccess: () => {
      setEditingName(false);
      return queryClient.invalidateQueries({ queryKey: ['course', id] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/courses/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['courses'] });
      navigate('/courses');
    },
  });

  const createCohortMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/courses/${id}/cohorts`, { method: 'POST', body: JSON.stringify({ name: cohortName }) }),
    onSuccess: () => {
      setCohortName('');
      return queryClient.invalidateQueries({ queryKey: ['cohorts', id] });
    },
  });

  if (isLoading) return <p className="text-ink-soft">Loading…</p>;
  if (error) return <p className="text-flag">{(error as Error).message}</p>;
  if (!course) return null;

  const activeAreas = course.areas.filter((a) => a.is_active);

  function startEdit(q: Question) {
    setEditingQuestionId(q.id);
    setEditQuestion({
      question_type: q.question_type ?? 'mcq',
      question_text: q.question_text,
      scenario_text: q.scenario_text ?? '',
      option_a: q.option_a ?? '',
      option_b: q.option_b ?? '',
      option_c: q.option_c ?? '',
      option_d: q.option_d ?? '',
      correct_option: (q.correct_option ?? 'a') as 'a' | 'b' | 'c' | 'd',
      assessment_type: q.assessment_type as 'pre' | 'post' | 'both',
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        {editingName ? (
          <div className="flex items-center gap-2">
            <input className="border rounded px-2 py-1 text-lg font-semibold" value={courseName} onChange={(e) => setCourseName(e.target.value)} autoFocus />
            <button onClick={() => renameMutation.mutate()} disabled={!courseName || renameMutation.isPending} className="text-sm text-ink underline">
              Save
            </button>
            <button onClick={() => setEditingName(false)} className="text-sm text-ink-soft underline">
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <h1 className="font-display font-semibold text-[26px] leading-tight tracking-[-0.015em] text-ink">{course.name}</h1>
            <button
              onClick={() => {
                setCourseName(course.name);
                setEditingName(true);
              }}
              className="text-xs text-ink-soft hover:underline"
            >
              Rename
            </button>
          </div>
        )}
        <div className="flex items-center gap-2">
          {course.is_locked && <span className="text-xs bg-amber-wash text-amber rounded px-2 py-1">Locked</span>}
          <button
            onClick={() => cloneMutation.mutate()}
            disabled={cloneMutation.isPending}
            className="text-sm border rounded px-3 py-1.5 hover:border-ink"
          >
            Clone
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-ink-soft">Delete?</span>
              <button onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending} className="text-flag underline">
                {deleteMutation.isPending ? 'Deleting…' : 'Confirm'}
              </button>
              <button onClick={() => setConfirmDelete(false)} className="text-ink-soft underline">
                Cancel
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="text-sm text-flag hover:underline">
              Delete
            </button>
          )}
        </div>
      </div>
      <p className="text-sm text-ink-soft mb-6">
        {course.category} · part of{' '}
        <Link to={`/frameworks/${course.framework.id}`} className="underline">
          {course.framework.name}
        </Link>
      </p>
      {deleteMutation.isError && <p className="text-sm text-flag mb-4">{(deleteMutation.error as Error).message}</p>}

      {course.is_locked && (
        <div className="bg-amber-wash border border-amber/20 text-amber text-sm rounded-lg p-3 mb-6">
          This course is locked because a cohort has started assessments against it. Clone it to make changes.
        </div>
      )}

      <div className="space-y-4">
        {course.areas.map((area) => (
          <div key={area.id} className={`bg-paper rounded-lg border border-rule p-5 ${!area.is_active ? 'opacity-50' : ''}`}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="font-display font-semibold text-[18px] tracking-[-0.01em] text-ink">{area.name}</h2>
                <p className="text-xs text-ink-soft">
                  {area.questions.filter((q) => q.is_active).length} of {area.questions.length} questions active
                </p>
              </div>
              {area.is_active && !course.is_locked && (
                <div>
                  {confirmDeactivate === area.id ? (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-ink-soft">Deactivate this area?</span>
                      <button onClick={() => deactivateAreaMutation.mutate(area.id)} className="text-flag underline">
                        Confirm
                      </button>
                      <button onClick={() => setConfirmDeactivate(null)} className="text-ink-soft underline">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeactivate(area.id)}
                      disabled={activeAreas.length <= 1}
                      title={activeAreas.length <= 1 ? 'At least one active area is required' : ''}
                      className="text-sm text-flag hover:underline disabled:text-sage disabled:no-underline"
                    >
                      Deactivate area
                    </button>
                  )}
                </div>
              )}
            </div>

            {area.active_question_warning && (
              <div className="bg-flag-wash border border-flag/20 text-flag text-xs rounded p-2 mb-3">Fewer than 8 active questions remain in this area.</div>
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
                      error={editQuestionMutation.isError ? (editQuestionMutation.error as Error).message : null}
                    />
                  ) : (
                    <div className="flex items-start justify-between gap-4">
                      <div className="text-sm text-ink">
                        {q.question_type === 'scenario' && q.scenario_text && <span className="block text-xs text-ink-soft italic">{q.scenario_text}</span>}
                        <span className={!q.is_active ? 'line-through text-sage' : ''}>{q.question_text}</span>
                        <span className="ml-2 text-xs text-sage">
                          ({q.question_type && q.question_type !== 'mcq' ? `${QUESTION_TYPE_LABEL[q.question_type]}, ` : ''}
                          {q.assessment_type})
                        </span>
                      </div>
                      {!course.is_locked && (
                        <div className="flex items-center gap-3 shrink-0">
                          <button onClick={() => startEdit(q)} className="text-xs text-ink-soft hover:underline">
                            Edit
                          </button>
                          <label className="flex items-center gap-1.5 text-xs text-ink-soft">
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

            {!course.is_locked && area.is_active && (
              <div className="mt-3 pt-3 border-t">
                {addingQuestionForArea === area.id ? (
                  <QuestionForm
                    values={newQuestion}
                    onChange={setNewQuestion}
                    onSubmit={() => addQuestionMutation.mutate({ areaId: area.id, values: newQuestion })}
                    onCancel={() => setAddingQuestionForArea(null)}
                    submitting={addQuestionMutation.isPending}
                    submitLabel="Add question"
                    error={addQuestionMutation.isError ? (addQuestionMutation.error as Error).message : null}
                  />
                ) : bulkUploadAreaId === area.id ? (
                  <div className="bg-ground rounded p-3 space-y-2">
                    <p className="text-xs text-ink-soft">
                      Columns: <code>question_type, question_text, scenario_text, option_a, option_b, option_c, option_d, correct_option, assessment_type</code>.
                      question_type is mcq (default), true_false, scenario or self_rating; the template shows one of each.
                    </p>
                    <div className="flex items-center gap-3">
                      <button onClick={downloadQuestionsCsvTemplate} className="text-xs text-ink-soft hover:underline">
                        Download template
                      </button>
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        disabled={bulkUploadMutation.isPending}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleBulkFileSelect(area.id, file);
                          e.target.value = '';
                        }}
                        className="text-xs"
                      />
                      <button onClick={() => setBulkUploadAreaId(null)} className="text-xs text-ink-soft hover:underline">
                        Cancel
                      </button>
                    </div>
                    {bulkUploadMutation.isPending && <p className="text-xs text-ink-soft">Uploading…</p>}
                    {bulkErrors && (
                      <ul className="text-xs text-flag list-disc pl-4">
                        {bulkErrors.map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => {
                        setAddingQuestionForArea(area.id);
                        setNewQuestion(EMPTY_QUESTION_FORM);
                      }}
                      className="text-sm text-ink hover:underline"
                    >
                      + Add question
                    </button>
                    <button
                      onClick={() => {
                        setBulkUploadAreaId(area.id);
                        setBulkErrors(null);
                      }}
                      className="text-sm text-ink hover:underline"
                    >
                      Bulk upload CSV
                    </button>
                    <button
                      onClick={() => {
                        setBankArea({ id: area.id, name: area.name });
                        setBankNotice(null);
                      }}
                      className="text-sm text-ink hover:underline"
                    >
                      From question bank
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {!course.is_locked && (
        <div className="mt-6 bg-paper rounded-lg border border-rule p-5">
          <h3 className="font-display font-semibold text-[16px] tracking-[-0.01em] text-ink mb-2">Add competency area</h3>
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
              className="bg-gain text-white text-sm rounded px-4 py-2 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {bankNotice && <p className="mt-4 text-sm text-gain">{bankNotice}</p>}
      {bankArea && (
        <QuestionBankModal
          courseId={course.id}
          areaId={bankArea.id}
          areaName={bankArea.name}
          onClose={() => setBankArea(null)}
          onImported={(n) => {
            setBankNotice(`Added ${n} question${n === 1 ? '' : 's'} to “${bankArea.name}”.`);
            setBankArea(null);
            invalidate();
          }}
        />
      )}

      {comparisonLocked && (cohorts?.length ?? 0) > 1 && (
        <p className="mt-8 text-sm text-ink-soft">
          Comparing this course's cohorts side by side comes with the Scale plan.{' '}
          <Link to="/billing" className="text-ink underline">
            See plans
          </Link>
        </p>
      )}

      {comparison && comparison.cohorts.some((c) => c.pairs > 0) && (
        <div className="mt-8 bg-paper rounded-lg border border-rule p-5">
          <h2 className="font-display font-semibold text-[18px] tracking-[-0.01em] text-ink mb-1">Cohorts compared</h2>
          <p className="text-sm text-ink-soft mb-4">How each run of this course performed, oldest first.</p>
          <CohortComparison cohorts={comparison.cohorts} />
        </div>
      )}

      <h2 className="font-display font-semibold text-[18px] tracking-[-0.01em] text-ink mt-8 mb-2">Cohorts</h2>
      <ul className="space-y-2 mb-6">
        {cohorts?.map((c) => (
          <li key={c.id}>
            <Link to={`/cohorts/${c.id}`} className="block bg-paper rounded-lg border border-rule p-4 hover:border-ink transition-shadow">
              <div className="flex items-center justify-between">
                <span className="font-medium text-ink">{c.name}</span>
                <span className="text-xs bg-ground rounded px-2 py-1 capitalize">{c.status}</span>
              </div>
            </Link>
          </li>
        ))}
        {cohorts?.length === 0 && <li className="text-ink-soft text-sm">No cohorts yet.</li>}
      </ul>

      <div className="bg-paper rounded-lg border border-rule p-5">
        <h3 className="font-display font-semibold text-[16px] tracking-[-0.01em] text-ink mb-3">Create cohort</h3>
        <div className="space-y-3">
          <input
            className="w-full border rounded px-3 py-2 text-sm"
            placeholder="Cohort name, e.g. Cohort 1 - Jan 2026"
            value={cohortName}
            onChange={(e) => setCohortName(e.target.value)}
          />
          {createCohortMutation.isError && (
            <p className="text-sm text-flag">
              {(createCohortMutation.error as Error).message}
              {createCohortMutation.error instanceof ApiError &&
                ['COHORT_LIMIT', 'BILLING_OVERDUE', 'CONTACT_SALES', 'UPGRADE_REQUIRED'].includes(createCohortMutation.error.code ?? '') && (
                  <>
                    {' '}
                    <Link to="/billing" className="underline">
                      Go to billing
                    </Link>
                  </>
                )}
            </p>
          )}
          <button
            onClick={() => createCohortMutation.mutate()}
            disabled={!cohortName || createCohortMutation.isPending}
            className="bg-gain text-white text-sm rounded px-4 py-2 disabled:opacity-50"
          >
            {createCohortMutation.isPending ? 'Creating…' : 'Create cohort'}
          </button>
        </div>
      </div>
    </div>
  );
}
