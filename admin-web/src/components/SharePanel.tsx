import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api';

type ShareLink = { id: string; token: string; label: string | null; created_at: string; view_count: number; last_viewed_at: string | null; revoked_at: string | null };

// Read-only links for funders: live aggregate results for this cohort, no
// login needed. Names, individual scores, comments and groups under five
// learners are never shown on the shared page.
export default function SharePanel({ cohortId, onClose }: { cohortId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const { data: links } = useQuery<ShareLink[]>({ queryKey: ['share-links', cohortId], queryFn: () => apiFetch(`/api/v1/cohorts/${cohortId}/share-links`) });

  const create = useMutation({
    mutationFn: () => apiFetch(`/api/v1/cohorts/${cohortId}/share-links`, { method: 'POST', body: JSON.stringify({ label: label || undefined }) }),
    onSuccess: (link: ShareLink) => {
      setLabel('');
      queryClient.invalidateQueries({ queryKey: ['share-links', cohortId] });
      copy(link);
    },
  });
  const revoke = useMutation({
    mutationFn: (linkId: string) => apiFetch(`/api/v1/cohorts/${cohortId}/share-links/${linkId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['share-links', cohortId] }),
  });

  const url = (l: ShareLink) => `${window.location.origin}/share/${l.token}`;
  async function copy(l: ShareLink) {
    await navigator.clipboard.writeText(url(l)).catch(() => undefined);
    setCopied(l.id);
    setTimeout(() => setCopied(null), 1500);
  }

  const active = links?.filter((l) => !l.revoked_at) ?? [];
  const revoked = links?.filter((l) => l.revoked_at) ?? [];

  return (
    <div className="fixed inset-0 z-50 bg-ink/60 flex items-start sm:items-center justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true" aria-label="Share with a funder" onClick={onClose}>
      <div className="bg-paper rounded-lg shadow-xl w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-rule">
          <h2 className="font-display font-semibold text-[18px] text-ink">Share results with a funder</h2>
          <button onClick={onClose} className="text-sm text-ink-soft hover:text-ink" aria-label="Close">
            Close ✕
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-ink-soft">
            Anyone with the link sees this cohort's live results — learning gain, pass rate, competency and equity breakdowns, satisfaction and follow-up
            outcomes. They never see learner names, individual scores, written comments, or any group smaller than five people. Turn a link off at any time.
          </p>
          <div className="flex gap-2">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Who is it for? e.g. Mastercard Foundation"
              maxLength={120}
              className="flex-1 border rounded px-3 py-1.5 text-sm"
            />
            <button onClick={() => create.mutate()} disabled={create.isPending} className="text-sm bg-gain text-white rounded px-3 py-1.5 disabled:opacity-50">
              {create.isPending ? 'Creating…' : 'Create link'}
            </button>
          </div>
          {create.isError && <p className="text-sm text-flag">{(create.error as Error).message}</p>}

          {active.length > 0 && (
            <ul className="divide-y divide-rule border border-rule rounded">
              {active.map((l) => (
                <li key={l.id} className="px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{l.label || 'Untitled link'}</p>
                      <p className="text-xs text-sage">
                        {l.view_count} view{l.view_count === 1 ? '' : 's'}
                        {l.last_viewed_at ? ` · last opened ${new Date(l.last_viewed_at).toLocaleDateString()}` : ''} · created {new Date(l.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="shrink-0 flex gap-2">
                      <a href={url(l)} target="_blank" rel="noopener noreferrer" className="text-xs border border-rule rounded px-2 py-1 hover:border-ink">
                        Open
                      </a>
                      <button onClick={() => copy(l)} className="text-xs border border-rule rounded px-2 py-1 hover:border-ink">
                        {copied === l.id ? 'Copied' : 'Copy'}
                      </button>
                      <button
                        onClick={() => window.confirm('Turn this link off? Anyone using it will no longer see the results.') && revoke.mutate(l.id)}
                        className="text-xs text-flag hover:underline"
                      >
                        Turn off
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {revoked.length > 0 && <p className="text-xs text-sage">{revoked.length} link{revoked.length === 1 ? '' : 's'} turned off.</p>}
        </div>
      </div>
    </div>
  );
}
