import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api';
import { QUESTION_TYPE_LABEL, type QuestionType } from './QuestionForm';

type BankQuestion = {
  id: string;
  question_type: QuestionType;
  question_text: string;
  scenario_text: string | null;
  option_a: string;
  option_b: string;
  option_c: string | null;
  option_d: string | null;
  correct_option: string | null;
  area_name: string;
  course_name: string;
  is_template: boolean;
};

// Reuse questions already written — the org's own, across all its courses,
// plus Daprova's template questions — instead of retyping them.
export default function QuestionBankModal({ courseId, areaId, areaName, onClose, onImported }: { courseId: string; areaId: string; areaName: string; onClose: () => void; onImported: (n: number) => void }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [type, setType] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isFetching } = useQuery<BankQuestion[]>({
    queryKey: ['question-bank', debounced, type],
    queryFn: () => apiFetch(`/api/v1/courses/question-bank/search?q=${encodeURIComponent(debounced)}${type ? `&type=${type}` : ''}`),
  });

  const importMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/courses/${courseId}/areas/${areaId}/questions/import`, { method: 'POST', body: JSON.stringify({ question_ids: [...selected] }) }),
    onSuccess: (r: { imported: number }) => onImported(r.imported),
  });

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink/60 flex items-start sm:items-center justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true" aria-label="Question bank" onClick={onClose}>
      <div className="bg-paper rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-rule">
          <div>
            <h2 className="font-display font-semibold text-[18px] text-ink">Question bank</h2>
            <p className="text-xs text-sage">Adding to “{areaName}”</p>
          </div>
          <button onClick={onClose} className="text-sm text-ink-soft hover:text-ink" aria-label="Close">
            Close ✕
          </button>
        </div>
        <div className="px-5 pt-4 flex flex-wrap gap-2">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search questions, areas or courses — e.g. budget, internet, safety"
            className="flex-1 min-w-[220px] border rounded px-3 py-1.5 text-sm"
          />
          <select value={type} onChange={(e) => setType(e.target.value)} className="border rounded px-2 py-1.5 text-sm" aria-label="Question type">
            <option value="">All types</option>
            {(Object.keys(QUESTION_TYPE_LABEL) as QuestionType[]).map((t) => (
              <option key={t} value={t}>
                {QUESTION_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="px-5 py-3 overflow-y-auto flex-1">
          {isFetching && !data && <p className="text-sm text-ink-soft">Searching…</p>}
          {data?.length === 0 && <p className="text-sm text-ink-soft">No questions match. Try a different word.</p>}
          <ul className="divide-y divide-rule">
            {data?.map((bq) => (
              <li key={bq.id} className="py-2.5">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" className="mt-1" checked={selected.has(bq.id)} onChange={() => toggle(bq.id)} />
                  <span className="min-w-0">
                    {bq.scenario_text && <span className="block text-xs text-ink-soft italic mb-0.5">{bq.scenario_text}</span>}
                    <span className="block text-sm text-ink">{bq.question_text}</span>
                    <span className="block text-xs text-sage mt-0.5">
                      {QUESTION_TYPE_LABEL[bq.question_type] ?? bq.question_type} · {bq.course_name} › {bq.area_name}
                      {bq.is_template ? ' · Daprova template' : ''}
                    </span>
                    {bq.question_type !== 'self_rating' && (
                      <span className="block text-xs text-ink-soft mt-0.5">
                        {(['a', 'b', 'c', 'd'] as const)
                          .map((l) => ({ l, text: bq[`option_${l}` as const] }))
                          .filter((o) => o.text)
                          .map((o) => (
                            <span key={o.l} className={`mr-3 ${bq.correct_option === o.l ? 'text-gain font-medium' : ''}`}>
                              {o.l.toUpperCase()}. {o.text}
                            </span>
                          ))}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
        <div className="px-5 py-3 border-t border-rule flex items-center justify-between gap-4">
          <span className="text-sm text-ink-soft">{selected.size} selected</span>
          <div className="flex items-center gap-3">
            {importMutation.isError && <span className="text-xs text-flag">{(importMutation.error as Error).message}</span>}
            <button onClick={() => importMutation.mutate()} disabled={selected.size === 0 || importMutation.isPending} className="text-sm bg-gain text-white rounded px-3 py-1.5 disabled:opacity-50">
              {importMutation.isPending ? 'Adding…' : `Add ${selected.size || ''} to this area`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
