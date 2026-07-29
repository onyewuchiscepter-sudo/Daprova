import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../api';
import { Badge, Banner, Button, EmptyState, Input, LinkButton, PageHeader, SectionTitle, btn } from '../components/ui';

type Course = { id: string; name: string; category: string; is_locked: boolean; created_at: string };
type FrameworkDetail = { id: string; name: string; category: string; version: number; courses: Course[] };

// A framework's own page is just its name/category and the list of Courses
// under it — each course owns its own competency areas/questions (see
// CourseDetailPage), so there's no area editor here anymore.
export default function FrameworkDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  const deleteMutation = useMutation({
    mutationFn: () => apiFetch(`/api/v1/frameworks/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['frameworks'] });
      navigate('/frameworks');
    },
  });

  if (isLoading) return <p className="text-sm text-ink-soft">Loading…</p>;
  if (error) return <Banner tone="flag">{(error as Error).message}</Banner>;
  if (!framework) return null;

  return (
    <div>
      {editingName ? (
        <div className="flex items-center gap-2 mb-6">
          <Input
            className="font-display text-[22px] font-semibold flex-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <Button onClick={() => renameMutation.mutate()} disabled={!name || renameMutation.isPending}>
            Save
          </Button>
          <Button variant="secondary" onClick={() => setEditingName(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <PageHeader
          eyebrow="Framework"
          title={framework.name}
          sub={
            <span className="font-mono text-[11px] text-sage">
              {framework.category} · v{framework.version}
            </span>
          }
          actions={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setName(framework.name);
                  setEditingName(true);
                }}
              >
                Rename
              </Button>
              {confirmDelete ? (
                <span className="flex items-center gap-2 text-sm">
                  <span className="text-ink-soft">Delete?</span>
                  <button onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending} className="text-flag underline">
                    {deleteMutation.isPending ? 'Deleting…' : 'Confirm'}
                  </button>
                  <button onClick={() => setConfirmDelete(false)} className={btn.quiet}>
                    Cancel
                  </button>
                </span>
              ) : (
                <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              )}
            </>
          }
        />
      )}

      {deleteMutation.isError && (
        <div className="mb-4">
          <Banner tone="flag">{(deleteMutation.error as Error).message}</Banner>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <SectionTitle>Courses</SectionTitle>
        <LinkButton to={`/courses/new?frameworkId=${framework.id}`}>Add course</LinkButton>
      </div>

      {framework.courses.length === 0 ? (
        <EmptyState action={<LinkButton to={`/courses/new?frameworkId=${framework.id}`}>Add the first course</LinkButton>}>
          No courses under this framework yet.
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {framework.courses.map((c) => (
            <li key={c.id}>
              <Link
                to={`/courses/${c.id}`}
                className="flex items-center justify-between gap-4 bg-paper border border-rule rounded-lg px-4 py-3.5 hover:border-ink transition-colors"
              >
                <div className="min-w-0">
                  <p className="font-medium text-ink truncate">{c.name}</p>
                  <p className="font-mono text-[11px] text-sage mt-0.5">{c.category}</p>
                </div>
                {c.is_locked && <Badge tone="amber">Locked</Badge>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
