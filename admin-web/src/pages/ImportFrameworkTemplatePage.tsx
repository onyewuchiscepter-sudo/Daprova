import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api';
import { Banner, Button, EmptyState, PageHeader } from '../components/ui';

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
      <PageHeader
        eyebrow="Templates"
        title="Import a framework template"
        sub="Brings in an entire curriculum at once — the framework and every course under it."
      />

      {isLoading && <p className="text-sm text-ink-soft">Loading…</p>}
      {templates && multiCourseTemplates.length === 0 && (
        <EmptyState>No multi-course templates are available yet.</EmptyState>
      )}

      <div className="space-y-2 mb-6">
        {multiCourseTemplates.map((t) => (
          <button
            key={t.id}
            onClick={() => setTemplateId(t.id)}
            aria-pressed={templateId === t.id}
            className={`w-full text-left rounded-lg border px-4 py-3.5 transition-colors ${
              templateId === t.id ? 'border-gain bg-gain-wash' : 'border-rule bg-paper hover:border-ink'
            }`}
          >
            <p className="font-medium text-ink">{t.name}</p>
            <p className="font-mono text-[11px] text-sage mt-0.5">{t.course_count} courses</p>
          </button>
        ))}
      </div>

      {importMutation.isError && (
        <div className="mb-4">
          <Banner tone="flag">{(importMutation.error as Error).message}</Banner>
        </div>
      )}
      <Button onClick={() => importMutation.mutate()} disabled={!templateId || importMutation.isPending}>
        {importMutation.isPending ? 'Importing…' : 'Import template'}
      </Button>
    </div>
  );
}
