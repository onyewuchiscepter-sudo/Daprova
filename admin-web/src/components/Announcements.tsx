import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api';

type Announcement = { id: string; title: string; body: string; level: 'info' | 'warning' };

const KEY = 'daprova.dismissedAnnouncements';
function readDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

// Notices from the Daprova team (platform console → Announcements). Each
// person can dismiss one; it stays dismissed in this browser.
export default function Announcements() {
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  const { data } = useQuery<Announcement[]>({
    queryKey: ['announcements'],
    queryFn: () => apiFetch('/api/v1/org/announcements'),
    refetchInterval: 5 * 60_000,
    retry: false,
  });

  function dismiss(id: string) {
    const next = [...dismissed, id].slice(-50);
    setDismissed(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Private browsing: dismissed for this visit only.
    }
  }

  const visible = (data ?? []).filter((a) => !dismissed.includes(a.id));
  if (!visible.length) return null;
  return (
    <div>
      {visible.map((a) => (
        <div
          key={a.id}
          role={a.level === 'warning' ? 'alert' : 'status'}
          className={`px-6 py-2.5 text-sm border-b flex items-start justify-between gap-4 ${
            a.level === 'warning' ? 'bg-amber-wash text-ink border-amber/20' : 'bg-gain-wash text-ink border-gain/20'
          }`}
        >
          <div className="max-w-6xl">
            <strong className="font-medium">{a.title}</strong>
            <span className="whitespace-pre-line text-ink-soft"> — {a.body}</span>
          </div>
          <button onClick={() => dismiss(a.id)} className="shrink-0 text-ink-soft hover:text-ink underline text-xs" aria-label={`Dismiss: ${a.title}`}>
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
