import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

export default function LoginPage() {
  const { signIn, selectOrg, pendingOrgSelection } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@acme-edtech.test');
  const [password, setPassword] = useState('devpassword123');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { requiresOrgSelection } = await signIn(email, password);
      if (!requiresOrgSelection) navigate('/frameworks');
      // else: pendingOrgSelection is now set on the auth context, and this
      // component re-renders below showing the org picker instead.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSelectOrg(orgId: string) {
    setError(null);
    setSubmitting(true);
    try {
      await selectOrg(orgId);
      navigate('/frameworks');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not select organisation');
    } finally {
      setSubmitting(false);
    }
  }

  // This person belongs to more than one org (docs/org-onboarding-spec.md
  // §2) — Firebase auth already succeeded, but the session isn't issued
  // until they pick which org to enter.
  if (pendingOrgSelection) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="bg-white shadow rounded-lg p-8 max-w-sm w-full space-y-4">
          <h1 className="text-xl font-semibold text-slate-900">Choose an organisation</h1>
          <div className="space-y-2">
            {pendingOrgSelection.orgs.map((o) => (
              <button
                key={o.id}
                disabled={submitting}
                onClick={() => handleSelectOrg(o.id)}
                className="w-full text-left border rounded px-3 py-2 hover:bg-slate-50 disabled:opacity-50"
              >
                <span className="font-medium text-slate-900">{o.name}</span>
                <span className="text-xs text-slate-500 ml-2 capitalize">({o.role})</span>
              </button>
            ))}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <form onSubmit={handleLogin} className="bg-white shadow rounded-lg p-8 max-w-sm w-full space-y-4">
        <h1 className="text-xl font-semibold text-slate-900">Daprova Admin — Sign in</h1>
        <input
          className="w-full border rounded px-3 py-2"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
        />
        <input
          className="w-full border rounded px-3 py-2"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={submitting} className="w-full bg-slate-900 text-white rounded px-3 py-2 disabled:opacity-50">
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="text-xs text-slate-400">Seed users via `npm run seed --workspace=api` first.</p>
      </form>
    </div>
  );
}
