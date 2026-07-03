import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { signInWithEmailAndPassword, signOut as fbSignOut } from 'firebase/auth';
import { auth } from './firebase';
import { apiFetch, setSessionToken } from './api';

type User = { id: string; email: string; display_name: string | null; role: 'admin' | 'viewer'; org_id: string };
type Org = { id: string; name: string; slug: string; contact_email: string };

type AuthState = {
  user: User | null;
  org: Org | null;
  loading: boolean;
  restoring: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function signIn(email: string, password: string) {
    setLoading(true);
    setError(null);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const idToken = await cred.user.getIdToken();
      const { session_token, user: apiUser } = await apiFetch('/api/v1/auth/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      setSessionToken(session_token);
      setUser(apiUser);
      const orgData = await apiFetch('/api/v1/org');
      setOrg(orgData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      throw err;
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    await apiFetch('/api/v1/auth/logout', { method: 'POST' }).catch(() => {});
    await fbSignOut(auth).catch(() => {});
    setSessionToken(null);
    setUser(null);
    setOrg(null);
  }

  // Best-effort session restore on refresh via the refresh-token cookie.
  useEffect(() => {
    (async () => {
      try {
        const { session_token } = await apiFetch('/api/v1/auth/refresh', { method: 'POST' });
        setSessionToken(session_token);
        const [meData, orgData] = await Promise.all([apiFetch('/api/v1/me'), apiFetch('/api/v1/org')]);
        setUser(meData);
        setOrg(orgData);
      } catch {
        // no valid refresh cookie — user needs to sign in
      } finally {
        setRestoring(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthContext.Provider value={{ user, org, loading, restoring, error, signIn, signOut }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
