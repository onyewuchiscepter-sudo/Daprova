import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { API_BASE } from '../api';
import { DaprovaMark } from '../components/Logo';

type Certificate = {
  code: string;
  learner_name: string | null;
  course_name: string;
  org_name: string;
  completed_at: string;
  pre_score: number | null;
  post_score: number | null;
  gain: number | null;
};

// Public certificate check: anyone (an employer, a funder) enters the code
// printed on a Daprova certificate and sees whether it's genuine.
export default function VerifyCertificatePage() {
  const { code } = useParams<{ code?: string }>();
  const navigate = useNavigate();
  const [input, setInput] = useState(code ?? '');
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'valid' | 'invalid'; cert?: Certificate }>({ status: code ? 'loading' : 'idle' });

  useEffect(() => {
    if (!code) return;
    setState({ status: 'loading' });
    fetch(`${API_BASE}/api/v1/public/certificates/${encodeURIComponent(code)}`)
      .then(async (r) => (r.ok ? setState({ status: 'valid', cert: await r.json() }) : setState({ status: 'invalid' })))
      .catch(() => setState({ status: 'invalid' }));
  }, [code]);

  return (
    <div className="min-h-screen bg-ground flex items-center justify-center p-6">
      <div className="bg-paper border border-rule rounded-lg p-6 w-full max-w-md">
        <div className="flex items-center gap-2 mb-4">
          <DaprovaMark size={28} />
          <h1 className="font-display font-semibold text-[20px] text-ink">Check a certificate</h1>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) navigate(`/verify/${input.trim().toUpperCase()}`);
          }}
          className="flex gap-2 mb-5"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="DPV-XXXX-XXXX"
            className="flex-1 border rounded px-3 py-2 text-sm font-mono uppercase"
            aria-label="Certificate code"
          />
          <button className="text-sm bg-gain text-white rounded px-3 py-2">Check</button>
        </form>

        {state.status === 'loading' && <p className="text-sm text-ink-soft">Checking…</p>}
        {state.status === 'invalid' && (
          <div className="rounded border border-flag/20 bg-flag-wash text-flag text-sm px-3 py-2">No certificate with that code. Check it was typed exactly as printed.</div>
        )}
        {state.status === 'valid' && state.cert && (
          <div className="rounded border border-gain/30 bg-gain-wash px-4 py-3">
            <p className="text-sm font-semibold text-gain-deep mb-2">✓ Genuine certificate</p>
            <dl className="text-sm space-y-1">
              <Row label="Awarded to" value={state.cert.learner_name ?? '—'} />
              <Row label="Course" value={state.cert.course_name} />
              <Row label="Delivered by" value={state.cert.org_name} />
              <Row label="Completed" value={new Date(state.cert.completed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} />
              {state.cert.pre_score !== null && state.cert.post_score !== null && (
                <Row label="Assessed skill" value={`${state.cert.pre_score}% → ${state.cert.post_score}% (${(state.cert.gain ?? 0) >= 0 ? '+' : ''}${state.cert.gain} points)`} />
              )}
              <Row label="Code" value={state.cert.code} />
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-28 shrink-0 text-ink-soft">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}
