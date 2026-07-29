import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../firebase';
import { useAuth } from '../auth';
import AuthShell, { Field, FormError, FormNotice, SubmitButton } from '../components/AuthShell';

export default function LoginPage() {
  const { signIn, selectOrg, pendingOrgSelection } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  async function handleForgotPassword() {
    if (!email) {
      setError('Enter your email address above, then select “Forgot password?” again.');
      return;
    }
    setError(null);
    setResetMessage(null);
    try {
      await sendPasswordResetEmail(auth, email);
      setResetMessage(`Reset link sent to ${email}. Check your inbox.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the reset email.');
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { requiresOrgSelection } = await signIn(email, password);
      if (!requiresOrgSelection) navigate('/courses');
      // else: pendingOrgSelection is now set on the auth context, and this
      // component re-renders below showing the org picker instead.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSelectOrg(orgId: string) {
    setError(null);
    setSubmitting(true);
    try {
      await selectOrg(orgId);
      navigate('/courses');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open that organisation.');
    } finally {
      setSubmitting(false);
    }
  }

  // This person belongs to more than one org (docs/org-onboarding-spec.md
  // §2) — Firebase auth already succeeded, but the session isn't issued
  // until they pick which org to enter.
  if (pendingOrgSelection) {
    return (
      <AuthShell eyebrow="Signed in" title="Choose an organisation" intro="Your account has access to more than one.">
        <div className="space-y-2">
          {pendingOrgSelection.orgs.map((o) => (
            <button
              key={o.id}
              disabled={submitting}
              onClick={() => handleSelectOrg(o.id)}
              className="w-full text-left border border-rule rounded px-3 py-2.5 hover:border-gain disabled:opacity-50 transition-colors"
            >
              <span className="block text-sm font-medium text-ink">{o.name}</span>
              <span className="block font-mono text-[11px] uppercase tracking-[0.1em] text-sage mt-0.5">{o.role}</span>
            </button>
          ))}
          {error && <FormError>{error}</FormError>}
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Administrator"
      title="Sign in"
      footer={
        <>
          New organisation?{' '}
          <Link to="/signup" className="text-ink underline hover:text-gain">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={handleLogin} className="space-y-4">
        <Field label="Email" value={email} onChange={setEmail} type="email" required autoComplete="email" />
        <Field label="Password" value={password} onChange={setPassword} type="password" required autoComplete="current-password" />
        {error && <FormError>{error}</FormError>}
        {resetMessage && <FormNotice>{resetMessage}</FormNotice>}
        <SubmitButton disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</SubmitButton>
        <button type="button" onClick={handleForgotPassword} className="w-full text-xs text-ink-soft hover:text-ink underline">
          Forgot password?
        </button>
      </form>
    </AuthShell>
  );
}
