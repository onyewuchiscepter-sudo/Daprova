import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api';

type Kind = 'post' | 'satisfaction' | 'tracer';
type Candidate = {
  learner_id: string;
  display_name: string | null;
  has_email: boolean;
  has_phone: boolean;
  last_reminded_at: string | null;
  reminder_count: number;
  whatsapp_url: string | null;
  personal_link: string;
};
type Candidates = { kind: Kind; channels: { email: boolean; sms: boolean; whatsapp: boolean }; cooldown_hours: number; learners: Candidate[] };
type SendSummary = { sent: number; failed: number; skipped_no_contact: number; skipped_recent: number; errors: string[] };

const KIND_LABEL: Record<Kind, { tab: string; who: string; empty: string }> = {
  post: { tab: 'Post-assessment', who: 'did the pre-assessment but not the post-assessment', empty: 'Everyone who started has finished the post-assessment.' },
  satisfaction: { tab: 'Feedback survey', who: 'finished the course but haven’t given feedback', empty: 'Everyone who finished has given feedback.' },
  tracer: { tab: 'Follow-up survey', who: 'finished the course but haven’t answered the follow-up', empty: 'Everyone who finished has answered the follow-up.' },
};

function ago(iso: string) {
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3600000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// Nudging learners who haven't finished a step. Each message carries the
// learner's personal link, which also works on a different phone.
export default function RemindersPanel({
  cohortId,
  initialKind = 'post',
  tracerEnabled = true,
  onClose,
}: {
  cohortId: string;
  initialKind?: Kind;
  // The follow-up survey is a Growth+ feature.
  tracerEnabled?: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<Kind>(initialKind === 'tracer' && !tracerEnabled ? 'post' : initialKind);
  const [result, setResult] = useState<{ channel: string; summary: SendSummary } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const { data, isLoading } = useQuery<Candidates>({
    queryKey: ['reminders', cohortId, kind],
    queryFn: () => apiFetch(`/api/v1/cohorts/${cohortId}/reminders?kind=${kind}`),
  });

  const send = useMutation({
    mutationFn: (channel: 'email' | 'sms') => apiFetch(`/api/v1/cohorts/${cohortId}/reminders`, { method: 'POST', body: JSON.stringify({ kind, channel }) }),
    onSuccess: (summary: SendSummary, channel) => {
      setResult({ channel, summary });
      queryClient.invalidateQueries({ queryKey: ['reminders', cohortId, kind] });
    },
  });

  const logWhatsapp = useMutation({
    mutationFn: (learnerId: string) => apiFetch(`/api/v1/cohorts/${cohortId}/reminders/log`, { method: 'POST', body: JSON.stringify({ kind, learner_id: learnerId }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reminders', cohortId, kind] }),
  });

  const learners = data?.learners ?? [];
  const withEmail = learners.filter((l) => l.has_email).length;
  const withPhone = learners.filter((l) => l.has_phone).length;

  async function copy(link: string, id: string) {
    await navigator.clipboard.writeText(link);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink/60 flex items-start sm:items-center justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true" aria-label="Send reminders" onClick={onClose}>
      <div className="bg-paper rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-rule">
          <h2 className="font-display font-semibold text-[18px] text-ink">Send reminders</h2>
          <button onClick={onClose} className="text-sm text-ink-soft hover:text-ink" aria-label="Close">
            Close ✕
          </button>
        </div>

        <div className="px-5 pt-4 flex flex-wrap gap-2">
          {(Object.keys(KIND_LABEL) as Kind[]).filter((k) => k !== 'tracer' || tracerEnabled).map((k) => (
            <button
              key={k}
              onClick={() => {
                setKind(k);
                setResult(null);
              }}
              className={`text-sm rounded-full px-3 py-1 border ${kind === k ? 'bg-ink text-white border-ink' : 'border-rule text-ink-soft hover:border-ink'}`}
            >
              {KIND_LABEL[k].tab}
            </button>
          ))}
        </div>

        <div className="px-5 py-4 overflow-y-auto">
          {isLoading && <p className="text-sm text-ink-soft">Loading…</p>}
          {data && learners.length === 0 && <p className="text-sm text-ink-soft">{KIND_LABEL[kind].empty}</p>}
          {data && learners.length > 0 && (
            <>
              <p className="text-sm text-ink mb-3">
                <strong>{learners.length}</strong> learner{learners.length === 1 ? '' : 's'} {KIND_LABEL[kind].who}.{' '}
                <span className="text-ink-soft">
                  {withEmail} shared an email, {withPhone} a phone number.
                </span>
              </p>

              <div className="flex flex-wrap gap-2 mb-2">
                <button
                  onClick={() => send.mutate('email')}
                  disabled={!data.channels.email || withEmail === 0 || send.isPending}
                  className="text-sm bg-gain text-white rounded px-3 py-1.5 disabled:opacity-50"
                  title={data.channels.email ? undefined : 'Email sending is not set up yet'}
                >
                  {send.isPending && send.variables === 'email' ? 'Sending…' : `Email ${withEmail}`}
                </button>
                <button
                  onClick={() => send.mutate('sms')}
                  disabled={!data.channels.sms || withPhone === 0 || send.isPending}
                  className="text-sm bg-gain text-white rounded px-3 py-1.5 disabled:opacity-50"
                  title={data.channels.sms ? undefined : 'SMS sending is not set up yet'}
                >
                  {send.isPending && send.variables === 'sms' ? 'Sending…' : `SMS ${withPhone}`}
                </button>
              </div>
              <p className="text-xs text-sage mb-4">
                {!data.channels.sms && 'SMS needs a Termii account (ask your Daprova contact). '}
                Learners reminded on a channel in the last {data.cooldown_hours} hours are skipped automatically. WhatsApp: use the buttons below — each
                opens your WhatsApp with the message ready to send.
              </p>

              {result && (
                <div
                  className={`text-sm rounded border px-3 py-2 mb-4 ${result.summary.failed ? 'bg-flag-wash border-flag/20 text-flag' : 'bg-gain-wash border-gain/20 text-gain-deep'}`}
                >
                  {result.summary.sent} sent by {result.channel}
                  {result.summary.skipped_recent ? `, ${result.summary.skipped_recent} skipped (reminded recently)` : ''}
                  {result.summary.skipped_no_contact ? `, ${result.summary.skipped_no_contact} without ${result.channel === 'email' ? 'an email' : 'a phone number'}` : ''}
                  {result.summary.failed ? `, ${result.summary.failed} failed — ${result.summary.errors.join('; ')}` : ''}.
                </div>
              )}
              {send.isError && <p className="text-sm text-flag mb-3">{(send.error as Error).message}</p>}

              <table className="w-full text-sm">
                <thead className="text-left text-ink-soft">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Learner</th>
                    <th className="py-2 pr-3 font-medium">Contact</th>
                    <th className="py-2 pr-3 font-medium">Last reminded</th>
                    <th className="py-2 font-medium text-right">Send yourself</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {learners.map((l) => (
                    <tr key={l.learner_id}>
                      <td className="py-2 pr-3">{l.display_name ?? 'Unnamed learner'}</td>
                      <td className="py-2 pr-3 text-xs text-ink-soft">{[l.has_email && 'Email', l.has_phone && 'Phone'].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="py-2 pr-3 text-xs text-ink-soft">{l.last_reminded_at ? `${ago(l.last_reminded_at)} (${l.reminder_count}×)` : 'Never'}</td>
                      <td className="py-2 text-right whitespace-nowrap">
                        {l.whatsapp_url && (
                          <a
                            href={l.whatsapp_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => logWhatsapp.mutate(l.learner_id)}
                            className="text-xs border border-rule rounded px-2 py-1 mr-2 hover:border-ink"
                          >
                            WhatsApp
                          </a>
                        )}
                        <button onClick={() => copy(l.personal_link, l.learner_id)} className="text-xs border border-rule rounded px-2 py-1 hover:border-ink">
                          {copied === l.learner_id ? 'Copied' : 'Copy link'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
