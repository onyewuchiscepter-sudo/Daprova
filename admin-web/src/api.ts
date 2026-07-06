const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:4001';

let sessionToken: string | null = null;
export function setSessionToken(token: string | null) {
  sessionToken = token;
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  // Only inject the stored Daprova session token if the caller didn't already
  // set an explicit Authorization header — auth.tsx's signIn() needs to send
  // the *Firebase* ID token to /auth/verify, which this used to silently
  // clobber with a stale (or absent) Daprova session token, causing
  // "Invalid Firebase ID token" even with a perfectly valid token.
  if (sessionToken && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${sessionToken}`);

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message ?? `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// For binary responses (report PDF/DOCX downloads) — same auth header
// handling as apiFetch, but returns the raw Blob instead of parsing JSON.
export async function apiFetchBlob(path: string): Promise<Blob> {
  const headers = new Headers();
  if (sessionToken) headers.set('Authorization', `Bearer ${sessionToken}`);
  const res = await fetch(`${API_BASE}${path}`, { headers, credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message ?? `Request failed: ${res.status}`);
  }
  return res.blob();
}
