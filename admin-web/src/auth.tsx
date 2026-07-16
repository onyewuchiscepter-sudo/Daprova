import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { signInWithEmailAndPassword, signOut as fbSignOut } from 'firebase/auth';
import { auth } from './firebase';
import { apiFetch, setSessionToken } from './api';

type User = { id: string; email: string; display_name: string | null; role: 'admin' | 'viewer'; org_id: string };
type Org = { id: string; name: string; slug: string; contact_email: string; verification_status: 'pending' | 'verified' | 'banned' };
type Membership = { id: string; name: string; role: 'admin' | 'viewer' };
type PendingOrgSelection = { org_selection_token: string; orgs: Membership[] };
// docs/org-onboarding-spec.md §7.3 — display-only; actual enforcement of
// read-only mode happens server-side (middleware/auth.ts), not here.
type Impersonation = { mode: 'write' | 'read_only'; orgName: string; targetEmail: string };

type AuthState = {
  user: User | null;
  org: Org | null;
  memberships: Membership[];
  pendingOrgSelection: PendingOrgSelection | null;
  impersonation: Impersonation | null;
  loading: boolean;
  restoring: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<{ requiresOrgSelection: boolean }>;
  selectOrg: (orgId: string) => Promise<void>;
  switchOrg: (orgId: string) => Promise<void>;
  signOut: () => Promise<void>;
  // Exposes applySession for flows that establish a session outside the
  // normal sign-in form — currently just AcceptInvitePage, which gets a
  // { session_token, user } pair back from POST /invites/:token/accept.
  completeSession: (result: { session_token: string; user: User }) => Promise<void>;
  adoptImpersonation: (sessionToken: string, info: Impersonation) => Promise<void>;
  endImpersonation: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [pendingOrgSelection, setPendingOrgSelection] = useState<PendingOrgSelection | null>(null);
  const [impersonation, setImpersonation] = useState<Impersonation | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Shared by every path that ends in a full session (single-org login,
  // org-selection, org-switching, and session restore-on-refresh) — always
  // fetches org + memberships alongside the session so the org-switcher has
  // up-to-date data regardless of how the session was established.
  async function applySession(result: { session_token: string; user: User }) {
    setSessionToken(result.session_token);
    setUser(result.user);
    setPendingOrgSelection(null);
    const [orgData, membershipsData] = await Promise.all([apiFetch('/api/v1/org'), apiFetch('/api/v1/org/memberships')]);
    setOrg(orgData);
    setMemberships(membershipsData);
  }

  // A person who belongs to more than one org (docs/org-onboarding-spec.md
  // §2) doesn't get a session directly from /auth/verify — instead they get
  // an org list + a short-lived selection token, and must call selectOrg()
  // to actually complete login. The return value tells the caller which
  // happened, since reading context state right after this resolves would
  // race React's own re-render.
  async function signIn(email: string, password: string): Promise<{ requiresOrgSelection: boolean }> {
    setLoading(true);
    setError(null);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const idToken = await cred.user.getIdToken();
      const result = await apiFetch('/api/v1/auth/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (result.requires_org_selection) {
        setPendingOrgSelection({ org_selection_token: result.org_selection_token, orgs: result.orgs });
        return { requiresOrgSelection: true };
      }
      await applySession(result);
      return { requiresOrgSelection: false };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      throw err;
    } finally {
      setLoading(false);
    }
  }

  async function selectOrg(orgId: string) {
    if (!pendingOrgSelection) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch('/api/v1/auth/select-org', {
        method: 'POST',
        body: JSON.stringify({ org_selection_token: pendingOrgSelection.org_selection_token, org_id: orgId }),
      });
      await applySession(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not select organisation');
      throw err;
    } finally {
      setLoading(false);
    }
  }

  // Re-issues a session scoped to a different org the signed-in person
  // belongs to — the org-switcher's entry point, no Firebase round-trip.
  // Every org-scoped query in this app is keyed without the org id in it
  // (e.g. ['frameworks'], ['courses']), so switching orgs mid-session
  // leaves every one of them holding data for the wrong org. A full reload
  // is simpler and more robust than surgically invalidating React Query's
  // cache: it re-runs the normal restore-on-mount flow against the cookie
  // /auth/switch-org just set, guaranteeing every piece of state on the
  // page — not just React Query's — is fresh for the newly active org.
  async function switchOrg(orgId: string) {
    await apiFetch('/api/v1/auth/switch-org', { method: 'POST', body: JSON.stringify({ org_id: orgId }) });
    window.location.reload();
  }

  async function signOut() {
    await apiFetch('/api/v1/auth/logout', { method: 'POST' }).catch(() => {});
    await fbSignOut(auth).catch(() => {});
    setSessionToken(null);
    setUser(null);
    setOrg(null);
    setMemberships([]);
    setPendingOrgSelection(null);
    queryClient.clear();
  }

  // docs/org-onboarding-spec.md §7.3 — adopts a pre-issued impersonation
  // token (minted by platform-web's POST /impersonation/start, handed off
  // via ImpersonatePage.tsx). No Firebase round-trip and no refresh-token
  // cookie: this session doesn't renew, it just expires at its 30-minute
  // hard TTL. `impersonation` info is display-only for the persistent
  // banner — the real enforcement is server-side (middleware/auth.ts).
  async function adoptImpersonation(token: string, info: Impersonation) {
    setSessionToken(token);
    const [meData, orgData] = await Promise.all([apiFetch('/api/v1/me'), apiFetch('/api/v1/org')]);
    setUser(meData);
    setOrg(orgData);
    setMemberships([]);
    setImpersonation(info);
  }

  async function endImpersonationSession() {
    await apiFetch('/api/v1/impersonation/end', { method: 'POST' }).catch(() => {});
    setSessionToken(null);
    setUser(null);
    setOrg(null);
    setMemberships([]);
    setImpersonation(null);
    queryClient.clear();
  }

  // Best-effort session restore on refresh via the refresh-token cookie.
  useEffect(() => {
    (async () => {
      try {
        const { session_token } = await apiFetch('/api/v1/auth/refresh', { method: 'POST' });
        setSessionToken(session_token);
        const [meData, orgData, membershipsData] = await Promise.all([
          apiFetch('/api/v1/me'),
          apiFetch('/api/v1/org'),
          apiFetch('/api/v1/org/memberships'),
        ]);
        setUser(meData);
        setOrg(orgData);
        setMemberships(membershipsData);
      } catch {
        // no valid refresh cookie — user needs to sign in
      } finally {
        setRestoring(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        org,
        memberships,
        pendingOrgSelection,
        impersonation,
        loading,
        restoring,
        error,
        signIn,
        selectOrg,
        switchOrg,
        signOut,
        completeSession: applySession,
        adoptImpersonation,
        endImpersonation: endImpersonationSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
