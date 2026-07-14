import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth';

// docs/org-onboarding-spec.md §7.3 — the landing point for a session
// platform-web opens in a new tab after POST /impersonation/start. All the
// query params are display-only (the token itself carries real
// enforcement); waits for the normal restore-on-mount effect to finish
// first so this adoption always runs last and wins, even if this browser
// happens to already hold an unrelated admin-web session cookie.
export default function ImpersonatePage() {
  const [params] = useSearchParams();
  const { adoptImpersonation, restoring } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (restoring || attempted.current) return;
    attempted.current = true;

    const token = params.get('token');
    const mode = params.get('mode');
    const orgName = params.get('org_name');
    const targetEmail = params.get('email');
    if (!token || (mode !== 'write' && mode !== 'read_only') || !orgName || !targetEmail) {
      setError('Missing or invalid impersonation link.');
      return;
    }

    adoptImpersonation(token, { mode, orgName, targetEmail })
      .then(() => navigate('/courses'))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not start impersonation session'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoring]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }
  return <div className="min-h-screen flex items-center justify-center text-slate-400">Starting impersonation session…</div>;
}
