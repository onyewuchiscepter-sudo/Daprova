import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { API_BASE, resolveApiUrl } from '../api';
import { DaprovaMark } from '../components/Logo';
import { ShareBars } from '../components/OutcomesPanel';

type Shared = {
  org_name: string;
  course_name: string;
  cohort_name: string;
  start_date: string | null;
  end_date: string | null;
  branding: { custom: boolean; color: string; logo_url: string | null };
  participation: { enrolled: number; pre_completed: number; post_completed: number };
  outcomes: { measured_learners: number; mean_pre: number | null; mean_post: number | null; mean_gain: number | null; pass_rate: number | null; pass_threshold: number; cohens_d: number | null };
  competency_breakdown: Array<{ area_name: string; pre_pct: number | null; post_pct: number | null }>;
  self_ratings: Array<{ area_name: string; pre_avg: number | null; post_avg: number | null }>;
  equity: Array<{ dimension: string; groups: Array<{ label: string; n: number; mean_gain: number | null; pass_rate: number | null }>; suppressed_groups: number }>;
  satisfaction: { response_count: number; avg_instructor_rating: number | null; avg_content_relevance: number | null; avg_delivery_satisfaction: number | null; nps_score: number | null } | null;
  follow_up: { response_count: number; employment: Array<{ label: string; count: number; pct: number }>; business: Array<{ label: string; count: number; pct: number }>; income: Array<{ label: string; count: number; pct: number }>; avg_training_contribution: number | null } | null;
  generated_at: string;
};

const DIMENSION: Record<string, string> = { gender: 'Gender', location_type: 'Location', age_group: 'Age group', disability: 'Disability' };
const pct = (v: number | null) => (v === null ? '—' : `${v}%`);
const signed = (v: number | null, unit = '') => (v === null ? '—' : `${v >= 0 ? '+' : ''}${v}${unit}`);

// Public, read-only results for one cohort, opened from a link the programme
// shared with its funder. Aggregates only — the API never sends names,
// individual scores, comments or groups under five people.
export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Shared | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/v1/public/share/${encodeURIComponent(token ?? '')}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body?.error?.message ?? 'This link is not available.');
        setData(body);
        document.title = `${body.cohort_name} · ${body.org_name}`;
      })
      .catch((e: Error) => setError(e.message));
  }, [token]);

  if (error) {
    return (
      <div className="min-h-screen bg-ground flex items-center justify-center p-6">
        <div className="bg-paper border border-rule rounded-lg p-6 max-w-md text-center">
          <DaprovaMark size={36} className="mx-auto mb-3" />
          <p className="text-ink font-medium mb-1">This results link isn't available</p>
          <p className="text-sm text-ink-soft">{error}</p>
        </div>
      </div>
    );
  }
  if (!data) return <div className="min-h-screen bg-ground flex items-center justify-center text-sm text-ink-soft">Loading results…</div>;

  const accent = data.branding.color;
  const o = data.outcomes;
  const postRate = data.participation.pre_completed ? Math.round((data.participation.post_completed / data.participation.pre_completed) * 100) : null;

  return (
    <div className="min-h-screen bg-ground">
      <header className="bg-paper border-b border-rule" style={{ borderTop: `4px solid ${accent}` }}>
        <div className="max-w-4xl mx-auto px-5 py-5 flex items-center gap-4">
          {data.branding.custom && data.branding.logo_url ? (
            <img src={resolveApiUrl(data.branding.logo_url)} alt={data.org_name} className="max-h-12 max-w-[180px] object-contain" />
          ) : (
            <DaprovaMark size={40} />
          )}
          <div className="min-w-0">
            <p className="text-sm text-ink-soft">{data.org_name}</p>
            <h1 className="font-display font-semibold text-[22px] leading-tight text-ink">{data.course_name}</h1>
            <p className="text-sm text-ink-soft">
              {data.cohort_name}
              {data.start_date ? ` · ${data.start_date}${data.end_date ? ` to ${data.end_date}` : ''}` : ''}
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-5 py-6 space-y-6">
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Tile label="Mean learning gain" value={signed(o.mean_gain, ' pts')} accent={accent} />
          <Tile label="Score before → after" value={`${pct(o.mean_pre)} → ${pct(o.mean_post)}`} />
          <Tile label={`Passed (≥ ${o.pass_threshold}%)`} value={pct(o.pass_rate)} />
          <Tile label="Learners measured" value={`${o.measured_learners}`} />
        </section>
        <p className="text-sm text-ink-soft">
          {data.participation.enrolled} learners enrolled; {data.participation.pre_completed} took the assessment at the start and {data.participation.post_completed} at the end
          {postRate !== null ? ` (${postRate}% completion)` : ''}.
          {o.cohens_d !== null ? ` Effect size (Cohen's d): ${o.cohens_d}.` : ''}
        </p>

        {data.competency_breakdown.length > 0 && (
          <Card title="Skills, before and after">
            <ul className="space-y-3">
              {data.competency_breakdown.map((a) => (
                <li key={a.area_name}>
                  <div className="flex justify-between text-sm gap-3">
                    <span className="text-ink">{a.area_name}</span>
                    <span className="font-mono text-xs text-ink-soft">
                      {pct(a.pre_pct)} → {pct(a.post_pct)}
                    </span>
                  </div>
                  <div className="relative h-2.5 bg-ground rounded-sm overflow-hidden mt-1">
                    <div className="absolute inset-y-0 left-0 bg-rule" style={{ width: `${a.pre_pct ?? 0}%` }} />
                    <div className="absolute left-0 bottom-0 h-1.5" style={{ width: `${a.post_pct ?? 0}%`, background: accent }} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {data.self_ratings.length > 0 && (
          <Card title="Learners' own confidence (1–5)">
            <ul className="space-y-1.5">
              {data.self_ratings.map((a) => (
                <li key={a.area_name} className="flex justify-between text-sm gap-3">
                  <span className="text-ink">{a.area_name}</span>
                  <span className="font-mono text-xs text-ink-soft">
                    {a.pre_avg ?? '—'} → {a.post_avg ?? '—'}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {data.equity.some((e) => e.groups.length > 0) && (
          <Card title="Who benefited">
            <div className="grid md:grid-cols-2 gap-5">
              {data.equity
                .filter((e) => e.groups.length > 0)
                .map((e) => (
                  <div key={e.dimension}>
                    <h4 className="text-sm font-semibold text-ink mb-1">{DIMENSION[e.dimension] ?? e.dimension}</h4>
                    <table className="w-full text-sm">
                      <tbody className="divide-y divide-rule">
                        {e.groups.map((g) => (
                          <tr key={g.label}>
                            <td className="py-1.5 capitalize">{g.label.replace(/_/g, ' ')}</td>
                            <td className="py-1.5 text-right font-mono text-xs text-ink-soft">n={g.n}</td>
                            <td className="py-1.5 text-right font-mono text-xs">{signed(g.mean_gain)}</td>
                            <td className="py-1.5 text-right font-mono text-xs text-ink-soft">{pct(g.pass_rate)} pass</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {e.suppressed_groups > 0 && <p className="text-[11px] text-sage mt-1">{e.suppressed_groups} smaller group(s) not shown to protect privacy.</p>}
                  </div>
                ))}
            </div>
          </Card>
        )}

        {data.satisfaction && (
          <Card title={`Learner satisfaction (${data.satisfaction.response_count} responses)`}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Tile label="Instructor" value={data.satisfaction.avg_instructor_rating !== null ? `${data.satisfaction.avg_instructor_rating} / 5` : '—'} />
              <Tile label="Relevance" value={data.satisfaction.avg_content_relevance !== null ? `${data.satisfaction.avg_content_relevance} / 5` : '—'} />
              <Tile label="Delivery" value={data.satisfaction.avg_delivery_satisfaction !== null ? `${data.satisfaction.avg_delivery_satisfaction} / 5` : '—'} />
              <Tile label="Net Promoter Score" value={data.satisfaction.nps_score !== null ? String(data.satisfaction.nps_score) : '—'} />
            </div>
          </Card>
        )}

        {data.follow_up && (
          <Card title={`After the programme (${data.follow_up.response_count} follow-up responses)`}>
            <div className="grid md:grid-cols-3 gap-5">
              <ShareBars title="Work now" rows={data.follow_up.employment} />
              <ShareBars title="Own business" rows={data.follow_up.business} />
              <ShareBars title="Income" rows={data.follow_up.income} />
            </div>
            {data.follow_up.avg_training_contribution !== null && (
              <p className="text-sm text-ink-soft mt-4">Learners rate the programme's contribution to these changes at {data.follow_up.avg_training_contribution} out of 5.</p>
            )}
          </Card>
        )}

        <footer className="flex items-center justify-between gap-4 text-xs text-sage pt-2">
          <span>Live results · updated {new Date(data.generated_at).toLocaleString()}</span>
          <span className="inline-flex items-center gap-1.5">
            <DaprovaMark size={14} /> Measured with Daprova
          </span>
        </footer>
      </main>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-paper rounded-lg border border-rule p-5">
      <h2 className="font-display font-semibold text-[17px] text-ink mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-paper rounded-lg border border-rule px-4 py-3">
      <p className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-sage">{label}</p>
      <p className="font-mono text-[19px] font-semibold mt-1" style={{ color: accent ?? '#12212e' }}>
        {value}
      </p>
    </div>
  );
}
