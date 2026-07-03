import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from './firebase';
import { apiFetch, setSessionToken } from './api';

type Org = { id: string; name: string; slug: string; contact_email: string };
type User = { id: string; email: string; display_name: string | null; role: string; org_id: string };

export default function App() {
  const [email, setEmail] = useState('admin@acme-edtech.test');
  const [password, setPassword] = useState('devpassword123');
  const [user, setUser] = useState<User | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const idToken = await cred.user.getIdToken();
      const { session_token, user } = await apiFetch('/api/v1/auth/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      setSessionToken(session_token);
      setUser(user);
      const orgData = await apiFetch('/api/v1/org');
      setOrg(orgData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  }

  if (user && org) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="bg-white shadow rounded-lg p-8 max-w-md w-full">
          <h1 className="text-xl font-semibold text-slate-900">Daprova Admin</h1>
          <p className="mt-2 text-slate-600">
            Signed in as <span className="font-medium">{user.email}</span> ({user.role})
          </p>
          <p className="mt-1 text-slate-600">
            Organisation: <span className="font-medium">{org.name}</span>
          </p>
          <p className="mt-4 text-sm text-emerald-600">Auth foundation working end-to-end.</p>
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
        <button type="submit" className="w-full bg-slate-900 text-white rounded px-3 py-2">
          Sign in
        </button>
        <p className="text-xs text-slate-400">Seed users via `npm run seed --workspace=api` first.</p>
      </form>
    </div>
  );
}
