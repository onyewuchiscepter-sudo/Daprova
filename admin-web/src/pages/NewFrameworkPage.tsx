import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api';

type Template = { id: string; name: string; category: string; area_count: number };

const CATEGORIES = [
  { value: 'digital_skills', label: 'Digital Skills' },
  { value: 'financial_literacy', label: 'Financial Literacy' },
  { value: 'coding', label: 'Coding & Web Dev' },
  { value: 'vocational', label: 'Vocational & Trade' },
  { value: 'agricultural', label: 'Agricultural & Rural' },
  { value: 'creator_economy', label: 'Creator Economy' },
];

export default function NewFrameworkPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Template | null>(null);
  const [name, setName] = useState('');
  const [fromScratch, setFromScratch] = useState(false);
  const [scratchCategory, setScratchCategory] = useState(CATEGORIES[0].value);

  const { data: templates, isLoading } = useQuery<Template[]>({
    queryKey: ['templates'],
    queryFn: () => apiFetch('/api/v1/frameworks/templates'),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch('/api/v1/frameworks', {
        method: 'POST',
        body: JSON.stringify(fromScratch ? { name, category: scratchCategory } : { templateId: selected!.id, name }),
      }),
    onSuccess: async (framework) => {
      await queryClient.invalidateQueries({ queryKey: ['frameworks'] });
      navigate(`/frameworks/${framework.id}`);
    },
  });

  function selectTemplate(t: Template) {
    setFromScratch(false);
    setSelected(t);
    if (!name) setName(t.name);
  }

  function startFromScratch() {
    setSelected(null);
    setFromScratch(true);
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900 mb-1">Select a competency template</h1>
      <p className="text-sm text-slate-500 mb-6">
        Choose a template matching your course category — you can customise it afterward, or{' '}
        <button onClick={startFromScratch} className="underline text-slate-700">
          start from scratch
        </button>{' '}
        instead.
      </p>

      {isLoading && <p className="text-slate-500">Loading templates…</p>}

      <div className="grid grid-cols-2 gap-3 mb-6">
        {templates?.map((t) => (
          <button
            key={t.id}
            onClick={() => selectTemplate(t)}
            className={`text-left rounded-lg border p-4 transition-colors ${
              selected?.id === t.id ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white hover:border-slate-400'
            }`}
          >
            <p className="font-medium text-slate-900">{t.name}</p>
            <p className="text-xs text-slate-500">{t.area_count} competency areas</p>
          </button>
        ))}
      </div>

      {(selected || fromScratch) && (
        <div className="bg-white rounded-lg shadow p-6 max-w-md space-y-4">
          <label className="block text-sm font-medium text-slate-700">
            Framework name
            <input className="mt-1 w-full border rounded px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          {fromScratch && (
            <label className="block text-sm font-medium text-slate-700">
              Category
              <select className="mt-1 w-full border rounded px-3 py-2" value={scratchCategory} onChange={(e) => setScratchCategory(e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <span className="block mt-1 text-xs text-slate-400">You'll add competency areas and questions on the next screen.</span>
            </label>
          )}
          {createMutation.isError && <p className="text-sm text-red-600">{(createMutation.error as Error).message}</p>}
          <button
            onClick={() => createMutation.mutate()}
            disabled={!name || createMutation.isPending}
            className="bg-slate-900 text-white text-sm rounded px-4 py-2 disabled:opacity-50"
          >
            {createMutation.isPending ? 'Creating…' : 'Create framework'}
          </button>
        </div>
      )}
    </div>
  );
}
