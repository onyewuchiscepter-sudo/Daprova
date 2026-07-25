import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api';

type Template = { id: string; name: string; category: string; course_count: number; area_count: number };

// For templates that represent a whole curriculum (many courses under one
// framework) rather than a single course — see NewCoursePage for the
// single-course template pick. Imports the entire framework + every course
// under it at once.
export default function ImportFrameworkTemplatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [templateId, setTemplateId] = useState('');

  const { data: templates, isLoading } = useQuery<Template[]>({
    queryKey: ['templates'],
    queryFn: () => apiFetch('/api/v1/frameworks/templates'),
  });
  const multiCourseTemplates = templates?.filter((t) => t.course_count > 1) ?? [];

  const importMutation = useMutation({
    mutationFn: () => apiFetch('/api/v1/frameworks/from-template', { method: 'POST', body: JSON.stringify({ templateId }) }),
    onSuccess: async (framework) => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['frameworks'] }), queryClient.invalidateQueries({ queryKey: ['courses'] })]);
      navigate(`/frameworks/${framework.id}`);
    },
  });

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900 mb-1">Import a framework template</h1>
      <p className="text-sm text-slate-500 mb-6">Brings in an entire curriculum at once — the framework and every one of its courses.</p>

      {isLoading && <p className="text-slate-500">Loading…</p>}
      {templates && multiCourseTemplates.length === 0 && (
        <div className="bg-white rounded-lg shadow p-8 text-center text-slate-500">No multi-course templates are available yet.</div>
      )}

      <div className="space-y-3 mb-6">
        {multiCourseTemplates.map((t) => (
          <button
            key={t.id}
            onClick={() => setTemplateId(t.id)}
            className={`w-full text-left rounded-lg border p-4 transition-colors ${
              templateId === t.id ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white hover:border-slate-400'
            }`}
          >
            <p className="font-medium text-slate-900">{t.name}</p>
            <p className="text-xs text-slate-500">{t.course_count} courses</p>
          </button>
        ))}
      </div>

      {importMutation.isError && <p className="text-sm text-red-600 mb-4">{(importMutation.error as Error).message}</p>}
      <button
        onClick={() => importMutation.mutate()}
        disabled={!templateId || importMutation.isPending}
        className="bg-slate-900 text-white text-sm rounded px-4 py-2 disabled:opacity-50"
      >
        {importMutation.isPending ? 'Importing…' : 'Import template'}
      </button>
    </div>
  );
}
