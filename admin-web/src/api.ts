export const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:4001';

// Carries the server's error.details alongside the message — errors.ts's
// badRequest(message, details) puts structured per-field/per-row info there
// (e.g. bulk CSV upload's per-row validation list), which a plain
// `new Error(message)` would otherwise silently drop on the floor.
export class ApiError extends Error {
  details?: unknown;
  // Machine-readable error code from the API (e.g. UPGRADE_REQUIRED,
  // REPORT_OVERAGE, BILLING_OVERDUE, COHORT_LIMIT, CONTACT_SALES).
  code?: string;
  status?: number;
  constructor(message: string, details?: unknown, code?: string, status?: number) {
    super(message);
    this.details = details;
    this.code = code;
    this.status = status;
  }
}

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
    throw new ApiError(body?.error?.message ?? `Request failed: ${res.status}`, body?.error?.details, body?.error?.code, res.status);
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
    throw new ApiError(body?.error?.message ?? `Request failed: ${res.status}`, body?.error?.details, body?.error?.code, res.status);
  }
  return res.blob();
}

// POST that answers with a file (report previews): returns the Blob plus
// response headers, since some previews describe themselves in headers.
export async function apiPostBlob(path: string, body: unknown): Promise<{ blob: Blob; headers: Headers }> {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (sessionToken) headers.set('Authorization', `Bearer ${sessionToken}`);
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body), credentials: 'include' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError(err?.error?.message ?? `Request failed: ${res.status}`, err?.error?.details, err?.error?.code, res.status);
  }
  return { blob: await res.blob(), headers: res.headers };
}

// Checkout URLs are absolute for real providers (Paystack/Flutterwave) and
// API-relative for the test stub.
export function resolveApiUrl(url: string): string {
  return /^https?:\/\//.test(url) ? url : `${API_BASE}${url}`;
}
