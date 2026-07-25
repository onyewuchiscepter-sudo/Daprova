import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../api';

type Template = { id: string; name: string; category: string; course_count: number; area_count: number };
type Framework = { id: string; name: string; category: string };

const CATEGORIES = [
  { value: 'digital_skills', label: 'Digital Skills' },
  { value: 'financial_literacy', label: 'Financial Literacy' },
  { value: 'coding', label: 'Coding & Web Dev' },
  { value: 'vocational', label: 'Vocational & Trade' },
  { value: 'agricultural', label: 'Agricultural & Rural' },
  { value: 'creator_economy', label: 'Creator Economy' },
];

type Mode = 'template' | 'existing' | 'scratch';

// Course creation is the one place a Framework gets created (or reused) —
// picking a template clones a framework + this course together in one step;
// picking an existing framework adds this course under it (no sharing of
// areas/questions between courses, even under the same framework); starting
// from scratch creates a brand-new framework just for this course.
export default function NewCoursePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const preselectedFrameworkId = searchParams.get('frameworkId');

  const [mode, setMode] = useState<Mode>(preselectedFrameworkId ? 'existing' : 'template');
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [frameworkId, setFrameworkId] = useState(preselectedFrameworkId ?? '');
  const [category, setCategory] = useState(CATEGORIES[0].value);

  const { data: templates } = useQuery<Template[]>({
    queryKey: ['templates'],
    queryFn: () => apiFetch('/api/v1/frameworks/templates'),
    enabled: mode === 'template',
  });
  const { data: frameworks } = useQuery<Framework[]>({
    queryKey: ['frameworks'],
    queryFn: () => apiFetch('/api/v1/frameworks'),
    enabled: mode === 'existing',
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const body =
        mode === 'template' ? { name, templateId } : mode === 'existing' ? { name, frameworkId } : { name, category };
      return apiFetch('/api/v1/courses', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: async (course) => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['courses'] }), queryClient.invalidateQueries({ queryKey: ['frameworks'] })]);
      navigate(`/courses/${course.id}`);
    },
  });

  const valid =
    Boolean(name) && (mode === 'template' ? Boolean(templateId) : mode === 'existing' ? Boolean(frameworkId) : Boolean(category));

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900 mb-1">New Course</h1>
      <p className="text-sm text-slate-500 mb-6">A course is one program — its own competency areas and questions, its own cohorts.</p>

      <div className="flex gap-4 border-b mb-6">
        {(
          [
            ['template', 'From a template'],
            ['existing', 'Existing framework'],
            ['scratch', 'From scratch'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setMode(value)}
            className={`pb-2 text-sm font-medium border-b-2 -mb-px ${mode === value ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'template' && (
        <div className="grid grid-cols-2 gap-3 mb-6">
          <p className="col-span-2 text-xs text-slate-400">
            Looking for a whole curriculum instead of one course?{' '}
            <Link to="/frameworks/import" className="underline">
              Import a framework template
            </Link>
            .
          </p>
          {templates?.filter((t) => t.course_count === 1).map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTemplateId(t.id);
                if (!name) setName(t.name);
              }}
              className={`text-left rounded-lg border p-4 transition-colors ${
                templateId === t.id ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white hover:border-slate-400'
              }`}
            >
              <p className="font-medium text-slate-900">{t.name}</p>
              <p className="text-xs text-slate-500">{t.area_count} competency areas</p>
            </button>
          ))}
        </div>
      )}

      {mode === 'existing' && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-slate-700 max-w-md">
            Framework
            <select className="mt-1 w-full border rounded px-3 py-2" value={frameworkId} onChange={(e) => setFrameworkId(e.target.value)}>
              <option value="">Select a framework…</option>
              {frameworks?.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <span className="block mt-1 text-xs text-slate-400">
              This course starts with no competency areas of its own — add them on the next screen.
            </span>
          </label>
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-6 max-w-md space-y-4">
        <label className="block text-sm font-medium text-slate-700">
          Course name
          <input className="mt-1 w-full border rounded px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {mode === 'scratch' && (
          <label className="block text-sm font-medium text-slate-700">
            Category
            <select className="mt-1 w-full border rounded px-3 py-2" value={category} onChange={(e) => setCategory(e.target.value)}>
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
          disabled={!valid || createMutation.isPending}
          className="bg-slate-900 text-white text-sm rounded px-4 py-2 disabled:opacity-50"
        >
          {createMutation.isPending ? 'Creating…' : 'Create course'}
        </button>
      </div>
    </div>
  );
}
