import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';
import { apiFetch } from '../api';
import { useAuth } from '../auth';
import AuthShell, { Field, FormError, SubmitButton } from '../components/AuthShell';

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
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'This invite link is not valid.'));
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
      navigate('/home');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not accept the invite.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <AuthShell eyebrow="Invitation" title="This link doesn't work">
        <p className="text-sm text-ink-soft">
          {loadError} Invites expire after a set period — ask whoever invited you to send a new one.
        </p>
      </AuthShell>
    );
  }
  if (!invite) {
    return (
      <AuthShell eyebrow="Invitation" title="Checking your invite…">
        <p className="text-sm text-ink-soft">One moment.</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow={`Invited as ${invite.role}`}
      title={`Join ${invite.org_name}`}
      intro="Set a password to finish setting up your account."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="block text-[13px] font-medium text-ink mb-1.5">Email</span>
          <input
            className="block w-full border border-rule rounded bg-ground px-3 py-2 text-sm text-ink-soft"
            value={invite.email}
            disabled
          />
          <span className="block mt-1 text-xs text-sage">Set by whoever invited you.</span>
        </label>
        <Field label="Full name" value={displayName} onChange={setDisplayName} autoComplete="name" />
        <Field
          label="Password"
          value={password}
          onChange={setPassword}
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          hint="At least 8 characters."
        />
        {submitError && <FormError>{submitError}</FormError>}
        <SubmitButton disabled={submitting}>{submitting ? 'Joining…' : 'Accept invite'}</SubmitButton>
      </form>
    </AuthShell>
  );
}
