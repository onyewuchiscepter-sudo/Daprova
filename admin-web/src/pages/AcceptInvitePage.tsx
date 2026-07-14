import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';
import { apiFetch } from '../api';
import { useAuth } from '../auth';

type InvitePreview = { org_name: string; email: string; role: 'admin' | 'viewer' };

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { completeSession } = useAuth();

  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch(`/api/v1/invites/${token}`)
      .then(setInvite)
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Invite not found'));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!invite) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const cred = await createUserWithEmailAndPassword(auth, invite.email, password);
      const idToken = await cred.user.getIdToken();
      const result = await apiFetch(`/api/v1/invites/${token}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ display_name: displayName || undefined }),
      });
      await completeSession(result);
      navigate('/frameworks');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not accept invite');
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-sm text-red-600">{loadError}</p>
      </div>
    );
  }
  if (!invite) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400">Loading…</div>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <form onSubmit={handleSubmit} className="bg-white shadow rounded-lg p-8 max-w-sm w-full space-y-4">
        <h1 className="text-xl font-semibold text-slate-900">Join {invite.org_name}</h1>
        <p className="text-sm text-slate-500">
          You've been invited as <span className="capitalize font-medium">{invite.role}</span>. Set a password to accept.
        </p>
        <label className="block text-xs text-slate-500">
          Email
          <input className="mt-1 block w-full border rounded px-3 py-2 bg-slate-100 text-slate-500" value={invite.email} disabled />
        </label>
        <label className="block text-xs text-slate-500">
          Full name
          <input className="mt-1 block w-full border rounded px-3 py-2" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label className="block text-xs text-slate-500">
          Password
          <input
            type="password"
            className="mt-1 block w-full border rounded px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>
        {submitError && <p className="text-sm text-red-600">{submitError}</p>}
        <button type="submit" disabled={submitting} className="w-full bg-slate-900 text-white rounded px-3 py-2 disabled:opacity-50">
          {submitting ? 'Joining…' : 'Accept invite'}
        </button>
      </form>
    </div>
  );
}
