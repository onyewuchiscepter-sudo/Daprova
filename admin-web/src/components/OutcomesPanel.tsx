import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api';

type Share = { label: string; count: number; pct: number };
export type Outcomes = {
  response_count: number;
  enrolled: number;
  employment: Share[];
  business: Share[];
  income: Share[];
  skill_usage: Share[];
  avg_training_contribution: number | null;
  stories: string[];
};

export const OUTCOME_LABELS: Record<string, string> = {
  employed_new: 'New job or promotion',
  employed_same: 'Same job as before',
  self_employed: 'Works for themselves',
  studying: 'Studying',
  seeking: 'Looking for work',
  not_seeking: 'Not looking for work',
  started: 'Started a business',
  grew: 'Business grew',
  same: 'About the same',
  none: 'No business',
  increased_a_lot: 'Increased a lot',
  increased: 'Increased',
  decreased: 'Decreased',
  prefer_not_to_say: 'Prefer not to say',
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every month',
  rarely: 'Rarely',
  never: 'Never',
};

export function ShareBars({ title, rows }: { title: string; rows: Share[] }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-ink mb-2">{title}</h4>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.label} className="text-sm">
            <div className="flex justify-between gap-2">
              <span className="text-ink">{OUTCOME_LABELS[r.label] ?? r.label.replace(/_/g, ' ')}</span>
              <span className="font-mono text-xs text-ink-soft">
                {r.pct}% ({r.count})
              </span>
            </div>
            <div className="h-1.5 bg-ground rounded-sm overflow-hidden mt-0.5">
              <div className="h-full bg-gain" style={{ width: `${r.pct}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Module 6: what learners say changed 3-6 months after the programme.
export default function OutcomesPanel({ cohortId, onRemind }: { cohortId: string; onRemind: () => void }) {
  const { data } = useQuery<Outcomes>({ queryKey: ['cohort-outcomes', cohortId], queryFn: () => apiFetch(`/api/v1/cohorts/${cohortId}/outcomes`) });
  if (!data) return <p className="text-sm text-ink-soft">Loading…</p>;

  if (data.response_count === 0) {
    return (
      <div className="bg-paper rounded-lg border border-rule p-5 text-sm text-ink-soft">
        <p className="mb-3">
          No follow-up answers yet. About 3–6 months after the programme, send learners the <strong>follow-up survey link</strong> (above) to find out what
          changed — jobs, businesses, income — which is what funders increasingly ask for.
        </p>
        <button onClick={onRemind} className="text-sm bg-gain text-white rounded px-3 py-1.5">
          Send the follow-up survey
        </button>
      </div>
    );
  }

  const employedNew = data.employment.find((e) => e.label === 'employed_new');
  const selfEmployed = data.employment.find((e) => e.label === 'self_employed');
  const incomeUp = data.income.filter((e) => e.label === 'increased' || e.label === 'increased_a_lot').reduce((a, b) => a + b.count, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Tile label="Responses" value={`${data.response_count} of ${data.enrolled}`} />
        <Tile label="New job / promotion" value={employedNew ? `${employedNew.pct}%` : '0%'} />
        <Tile label="Income increased" value={`${Math.round((incomeUp / data.response_count) * 1000) / 10}%`} />
        <Tile label="Programme contribution" value={data.avg_training_contribution !== null ? `${data.avg_training_contribution} / 5` : '—'} />
      </div>
      {selfEmployed && <p className="text-sm text-ink-soft">{selfEmployed.pct}% now work for themselves.</p>}
      <div className="bg-paper rounded-lg border border-rule p-5 grid md:grid-cols-2 gap-6">
        <ShareBars title="Work now" rows={data.employment} />
        <ShareBars title="Own business" rows={data.business} />
        <ShareBars title="Income since the programme" rows={data.income} />
        <ShareBars title="Uses what they learned" rows={data.skill_usage} />
      </div>
      {data.stories.length > 0 && (
        <div className="bg-paper rounded-lg border border-rule p-5">
          <h3 className="font-display font-semibold text-[16px] text-ink mb-3">In their words</h3>
          <ul className="space-y-3">
            {data.stories.map((s, i) => (
              <li key={i} className="text-sm text-ink border-l-2 border-gain pl-3">
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-paper rounded-lg border border-rule px-4 py-3.5">
      <p className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-sage">{label}</p>
      <p className="font-mono text-[21px] font-semibold text-ink mt-1">{value}</p>
    </div>
  );
}
