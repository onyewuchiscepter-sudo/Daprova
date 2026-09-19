import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js';
import {
  getAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
} from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js';

const API_BASE = window.DAPROVA_API_BASE || 'http://localhost:4001';
const ADMIN_WEB_ORIGIN = window.DAPROVA_ADMIN_WEB_ORIGIN || 'http://localhost:5173';
const app = document.getElementById('app');

const firebaseApp = initializeApp({
  projectId: window.DAPROVA_FIREBASE_PROJECT_ID,
  apiKey: window.DAPROVA_FIREBASE_API_KEY || 'fake-api-key',
});
const auth = getAuth(firebaseApp);
if (window.DAPROVA_FIREBASE_AUTH_EMULATOR_HOST) {
  connectAuthEmulator(auth, `http://${window.DAPROVA_FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
}

// Deliberately no session persistence/refresh-token flow for this internal
// tool (v1 scope, docs/org-onboarding-spec.md §7.5) — it's low-traffic
// enough that "sign in again if you reload the tab" is an acceptable
// simplification, and it avoids the cookie/CORS-credentials machinery
// admin-web needs for its much more frequently-used session.
let sessionToken = null;

async function api(path, opts = {}) {
  const headers = new Headers(opts.headers);
  headers.set('Content-Type', 'application/json');
  if (sessionToken) headers.set('Authorization', `Bearer ${sessionToken}`);
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `Request failed: ${res.status}`);
  return body;
}

// Everything here is signup-supplied (org names, addresses, emails...) and
// gets written into innerHTML — escape every value, or a crafted org name
// runs script inside a platform admin's session.
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

function render(html) {
  app.innerHTML = html;
}

function renderLogin(error) {
  render(`
    <h1>Daprova Platform</h1>
    <div class="card">
      <form id="login-form">
        <label>Email<input type="email" id="email" required /></label>
        <label>Password<input type="password" id="password" required /></label>
        ${error ? `<p class="error">${esc(error)}</p>` : ''}
        <button type="submit">Sign in</button>
      </form>
    </div>
  `);
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const idToken = await cred.user.getIdToken();
      const result = await api('/api/v1/auth/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (result.requires_org_selection) {
        // v1 scope: just enter using the first org this person belongs to
        // — platform routes don't care which org the session is scoped to
        // (platform-admin status is checked independently of org context).
        const selected = await api('/api/v1/auth/select-org', {
          method: 'POST',
          body: JSON.stringify({ org_selection_token: result.org_selection_token, org_id: result.orgs[0].id }),
        });
        sessionToken = selected.session_token;
      } else {
        sessionToken = result.session_token;
      }
      await renderMain();
    } catch (err) {
      renderLogin(err.message);
    }
  });
}

async function renderMain(status) {
  let orgs = [];
  let loadError = null;
  try {
    orgs = await api('/api/v1/platform/orgs');
  } catch (err) {
    loadError = err.message;
  }

  let flags = [];
  let flagsError = null;
  try {
    flags = await api('/api/v1/platform/fraud-flags');
  } catch (err) {
    flagsError = err.message;
  }
  const pendingFlags = flags.filter((f) => !f.reviewed_at);

  let pendingVerification = [];
  let verificationError = null;
  try {
    pendingVerification = await api('/api/v1/platform/orgs/pending-verification');
  } catch (err) {
    verificationError = err.message;
  }

  let providers = null;
  let payments = [];
  try {
    [providers, payments] = await Promise.all([api('/api/v1/platform/payments/providers'), api('/api/v1/platform/payments')]);
  } catch (err) {
    providers = { error: err.message };
  }
  const yesNo = (v) => (v ? '✓ keys set' : '✗ not configured');

  render(`
    <h1>Daprova Platform</h1>

    <h2>Payments</h2>
    <div class="card">
      ${providers?.error ? `<p class="error">${esc(providers.error)}</p>` : `
        <p><strong>New checkouts use:</strong> ${esc(providers?.active)}${providers?.active === 'stub' ? ' <span class="muted">(test mode — no real money moves; add PAYSTACK_SECRET_KEY or FLUTTERWAVE_SECRET_KEY as API secrets to go live)</span>' : ''}</p>
        <p class="muted">Paystack: ${yesNo(providers?.paystack_configured)} &nbsp;·&nbsp; Flutterwave: ${yesNo(providers?.flutterwave_configured)} (webhook hash: ${yesNo(providers?.flutterwave_webhook_hash_configured)})</p>`}
      <table>
        <thead><tr><th>Organisation</th><th>Amount</th><th>Plan</th><th>Gateway</th><th>Status</th><th>Opened</th></tr></thead>
        <tbody>
          ${payments
            .map(
              (p) => `<tr><td>${esc(p.org_name)}</td><td>&#8358;${esc(Number(p.amount).toLocaleString())}</td><td>${esc(p.target_tier)}</td><td>${esc(p.provider)}</td><td>${esc(p.status)}${p.failure_reason ? ` <span class="muted">(${esc(p.failure_reason)})</span>` : ''}</td><td>${esc(new Date(p.created_at).toLocaleString())}</td></tr>`,
            )
            .join('') || '<tr><td colspan="6" class="muted">No payments yet.</td></tr>'}
        </tbody>
      </table>
    </div>

    <h2>Orgs awaiting verification</h2>
    <p class="muted">Self-serve signups start pending — they can already build frameworks/courses, but team management stays locked until you verify, suspend, or ban the registration here.</p>
    <div class="card">
      ${verificationError ? `<p class="error">${esc(verificationError)}</p>` : ''}
      ${status?.verifyError ? `<p class="error">${esc(status.verifyError)}</p>` : ''}
      <table>
        <thead><tr><th>Organisation</th><th>Type</th><th>CAC number</th><th>Registered</th><th></th></tr></thead>
        <tbody>
          ${pendingVerification
            .map(
              (o) => `
            <tr>
              <td>${esc(o.name)}</td>
              <td>${esc(o.org_type ?? '')}</td>
              <td>${esc(o.cac_registration_number ?? '')}</td>
              <td>${new Date(o.created_at).toLocaleDateString()}</td>
              <td><button class="review-verification-btn" data-id="${esc(o.id)}">Review</button></td>
            </tr>`,
            )
            .join('') || '<tr><td colspan="5" class="muted">No organisations awaiting verification.</td></tr>'}
        </tbody>
      </table>
    </div>

    <h2>Signup fraud review</h2>
    <p class="muted">docs/org-onboarding-spec.md §7.2 — a match doesn't block signup, it just lands here for review.</p>
    <div class="card">
      ${flagsError ? `<p class="error">${esc(flagsError)}</p>` : ''}
      ${status?.flagError ? `<p class="error">${esc(status.flagError)}</p>` : ''}
      <table>
        <thead><tr><th>New org</th><th>Matches</th><th>Reason</th><th>Flagged</th><th></th></tr></thead>
        <tbody>
          ${pendingFlags
            .map(
              (f) => `
            <tr data-flag-id="${esc(f.id)}">
              <td>${esc(f.org_name)}</td>
              <td>${esc(f.matched_org_name)}</td>
              <td>${esc(f.match_reason)}</td>
              <td>${new Date(f.created_at).toLocaleDateString()}</td>
              <td>
                <button class="review-btn" data-id="${esc(f.id)}" data-decision="approved">Approve</button>
                <button class="review-btn" data-id="${esc(f.id)}" data-decision="rejected">Reject</button>
              </td>
            </tr>`,
            )
            .join('') || '<tr><td colspan="5" class="muted">No flagged signups pending review.</td></tr>'}
        </tbody>
      </table>
    </div>

    <h2>Organisations</h2>
    <div class="card">
      ${loadError ? `<p class="error">${esc(loadError)}</p>` : ''}
      <table>
        <thead><tr><th>Name</th><th>Slug</th><th>Contact</th><th>Billing status</th><th>Verification</th><th>Created</th><th></th></tr></thead>
        <tbody>
          ${orgs
            .map(
              (o) => `
            <tr>
              <td>${esc(o.name)}${o.deleted_at ? ' <span class="muted">(closed)</span>' : ''}</td>
              <td>${esc(o.slug)}</td><td>${esc(o.contact_email)}</td><td>${esc(o.billing_status ?? '')}</td>
              <td>${esc(o.verification_status ?? '')}</td>
              <td>${new Date(o.created_at).toLocaleDateString()}</td>
              <td><button class="manage-btn" data-id="${esc(o.id)}">Manage</button></td>
            </tr>`,
            )
            .join('') || '<tr><td colspan="7" class="muted">No organisations yet.</td></tr>'}
        </tbody>
      </table>
    </div>

    <h2>Create organisation (Model B)</h2>
    <p class="muted">Creates the org and its first admin directly, with a real password — no invite email. Communicate the login to the customer yourself afterward.</p>
    <div class="card">
      <form id="create-org-form">
        <label>Organisation name<input id="org_name" required /></label>
        <label>Slug<input id="org_slug" required placeholder="acme-edtech" /></label>
        <label>Contact email<input type="email" id="contact_email" required /></label>
        <label>Admin full name<input id="admin_display_name" /></label>
        <label>Admin email<input type="email" id="admin_email" required /></label>
        <label>Admin password<input type="password" id="admin_password" required minlength="8" /></label>
        ${status?.error ? `<p class="error">${esc(status.error)}</p>` : ''}
        ${status?.success ? `<p class="muted">Created: ${esc(status.success)}</p>` : ''}
        <button type="submit">Create organisation</button>
      </form>
    </div>
  `);

  document.getElementById('create-org-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      org_name: document.getElementById('org_name').value,
      org_slug: document.getElementById('org_slug').value,
      contact_email: document.getElementById('contact_email').value,
      admin_display_name: document.getElementById('admin_display_name').value || undefined,
      admin_email: document.getElementById('admin_email').value,
      admin_password: document.getElementById('admin_password').value,
    };
    try {
      const result = await api('/api/v1/platform/orgs', { method: 'POST', body: JSON.stringify(body) });
      await renderMain({ success: `${result.org.name} (${result.admin.email})` });
    } catch (err) {
      await renderMain({ error: err.message });
    }
  });

  document.querySelectorAll('.review-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/v1/platform/fraud-flags/${btn.dataset.id}/review`, {
          method: 'POST',
          body: JSON.stringify({ decision: btn.dataset.decision }),
        });
        await renderMain();
      } catch (err) {
        await renderMain({ flagError: err.message });
      }
    });
  });

  document.querySelectorAll('.manage-btn').forEach((btn) => {
    btn.addEventListener('click', () => renderOrgDetail(btn.dataset.id));
  });

  document.querySelectorAll('.review-verification-btn').forEach((btn) => {
    btn.addEventListener('click', () => renderOrgDetail(btn.dataset.id));
  });
}

// docs/org-onboarding-spec.md §7.2 — org regulation actions. `support` can
// view this page; the mutating buttons below are `owner`-only server-side
// (platform.ts's `ownerOnly` gate) — a `support` admin sees the same
// buttons but gets a clean 403 message if they try one, rather than this
// page trying to duplicate the role check.
async function renderOrgDetail(orgId, status) {
  let org;
  try {
    org = await api(`/api/v1/platform/orgs/${orgId}`);
  } catch (err) {
    render(`<h1>Daprova Platform</h1><p class="error">${esc(err.message)}</p><button id="back-btn">Back</button>`);
    document.getElementById('back-btn').addEventListener('click', () => renderMain());
    return;
  }

  const isSuspended = org.billing_status === 'suspended';
  const isPendingVerification = org.verification_status === 'pending';
  const isBanned = org.verification_status === 'banned';
  const admin = org.members.find((m) => m.role === 'admin') ?? org.members[0];

  render(`
    <h1>Daprova Platform</h1>
    <button id="back-btn">&larr; Back to organisations</button>
    <h2>${esc(org.name)} ${org.deleted_at ? '<span class="muted">(closed)</span>' : ''}</h2>
    <div class="card">
      <p><strong>Slug:</strong> ${esc(org.slug)} &nbsp; <strong>Billing status:</strong> ${esc(org.billing_status)} &nbsp;
         <strong>Free trial used:</strong> ${org.has_used_free_trial ? 'yes' : 'no'} &nbsp;
         <strong>Signup review:</strong> ${esc(org.signup_review_status ?? 'none')} &nbsp;
         <strong>Verification status:</strong> ${esc(org.verification_status)}</p>
      ${status?.error ? `<p class="error">${esc(status.error)}</p>` : ''}
      ${status?.success ? `<p class="muted">${esc(status.success)}</p>` : ''}
      <div class="actions">
        ${isPendingVerification ? '<button id="verify-btn">Verify</button>' : ''}
        ${
          isSuspended
            ? '<button id="reactivate-btn">Reactivate org</button>'
            : '<button id="suspend-btn">Suspend org</button>'
        }
        ${!isBanned ? '<button id="ban-btn">Ban</button>' : ''}
        <button id="extend-trial-btn">Grant free-trial exception</button>
        <button id="close-org-btn">Close org</button>
      </div>
    </div>

    <h3>Registration details</h3>
    <p class="muted">Captured at signup — everything except password. Review this before verifying, suspending, or banning.</p>
    <div class="card">
      <table>
        <tbody>
          <tr><td><strong>Organisation type</strong></td><td>${esc(org.org_type ?? '')}</td></tr>
          <tr><td><strong>CAC registration number</strong></td><td>${esc(org.cac_registration_number ?? '')}</td></tr>
          <tr><td><strong>Website / social link</strong></td><td>${esc(org.website_url ?? '')}</td></tr>
          <tr><td><strong>Address</strong></td><td>${esc(org.address ?? '')}</td></tr>
          <tr><td><strong>Primary use case</strong></td><td>${esc(org.primary_use_case ?? '')}</td></tr>
          <tr><td><strong>Expected cadence</strong></td><td>${esc(org.expected_cadence ?? '')}</td></tr>
          <tr><td><strong>Reports to funder</strong></td><td>${org.reports_to_funder ? `yes (${esc(org.reports_to_funder_name ?? 'unnamed')})` : 'no'}</td></tr>
          <tr><td><strong>Referral source</strong></td><td>${esc(org.referral_source ?? '')}</td></tr>
          <tr><td><strong>Admin name</strong></td><td>${esc(admin?.display_name ?? '')}</td></tr>
          <tr><td><strong>Admin title</strong></td><td>${esc(admin?.title ?? '')}</td></tr>
          <tr><td><strong>Admin phone</strong></td><td>${esc(admin?.phone ?? '')}</td></tr>
          <tr><td><strong>Admin email</strong></td><td>${esc(admin?.email ?? '')}</td></tr>
        </tbody>
      </table>
    </div>

    <h3>Members</h3>
    <p class="muted">docs/org-onboarding-spec.md §7.3 — a reason is required for every impersonation. Mode (write/read-only) is derived from your own platform role, not chosen here.</p>
    <div class="card">
      <table>
        <thead><tr><th>Email</th><th>Name</th><th>Role</th><th></th></tr></thead>
        <tbody>
          ${org.members
            .map(
              (m) => `<tr><td>${esc(m.email)}</td><td>${esc(m.display_name ?? '')}</td><td>${esc(m.role)}</td>
            <td><button class="impersonate-btn" data-person-id="${esc(m.id)}" data-email="${esc(m.email)}">Impersonate</button></td></tr>`,
            )
            .join('') || '<tr><td colspan="4" class="muted">No members.</td></tr>'}
        </tbody>
      </table>
    </div>

    <h3>Cohorts</h3>
    <div class="card">
      <table>
        <thead><tr><th>Name</th><th>Status</th><th>Students</th><th>Tier</th><th>Override to</th></tr></thead>
        <tbody>
          ${org.cohorts
            .map(
              (c) => `
            <tr>
              <td>${esc(c.name)}</td><td>${esc(c.status)}</td><td>${esc(c.student_count)}</td><td>${esc(c.plan_tier_at_creation ?? '(none)')}</td>
              <td>
                <select class="tier-select" data-cohort-id="${esc(c.id)}">
                  ${['FREE_TRIAL', 'ENTRY', 'GROWTH', 'SCALE_1', 'SCALE_2', 'ENTERPRISE'].map((t) => `<option value="${t}">${t}</option>`).join('')}
                </select>
                <button class="override-tier-btn" data-cohort-id="${esc(c.id)}">Override</button>
              </td>
            </tr>`,
            )
            .join('') || '<tr><td colspan="5" class="muted">No cohorts.</td></tr>'}
        </tbody>
      </table>
    </div>

    <h3>Manually correct billing status</h3>
    <div class="card">
      <select id="billing-status-select">
        ${['active', 'locked_pending_upgrade', 'pending_manual_quote', 'suspended'].map((s) => `<option value="${s}" ${s === org.billing_status ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
      <button id="correct-billing-btn">Apply</button>
    </div>
  `);

  document.getElementById('back-btn').addEventListener('click', () => renderMain());

  const act = async (fn) => {
    try {
      await fn();
      await renderOrgDetail(orgId, { success: 'Done.' });
    } catch (err) {
      await renderOrgDetail(orgId, { error: err.message });
    }
  };

  document.getElementById('verify-btn')?.addEventListener('click', () => act(() => api(`/api/v1/platform/orgs/${orgId}/verify`, { method: 'POST' })));
  document.getElementById('ban-btn')?.addEventListener('click', () => {
    if (!confirm(`Ban ${org.name}? This is permanent — the org will be closed and can no longer log in.`)) return;
    act(() => api(`/api/v1/platform/orgs/${orgId}/ban`, { method: 'POST' }));
  });
  document.getElementById('suspend-btn')?.addEventListener('click', () => act(() => api(`/api/v1/platform/orgs/${orgId}/suspend`, { method: 'POST' })));
  document.getElementById('reactivate-btn')?.addEventListener('click', () => act(() => api(`/api/v1/platform/orgs/${orgId}/reactivate`, { method: 'POST' })));
  document.getElementById('close-org-btn').addEventListener('click', () => act(() => api(`/api/v1/platform/orgs/${orgId}/close`, { method: 'POST' })));
  document.getElementById('extend-trial-btn').addEventListener('click', () => act(() => api(`/api/v1/platform/orgs/${orgId}/extend-free-trial`, { method: 'POST' })));
  document.getElementById('correct-billing-btn').addEventListener('click', () =>
    act(() =>
      api(`/api/v1/platform/orgs/${orgId}/billing-status`, {
        method: 'POST',
        body: JSON.stringify({ status: document.getElementById('billing-status-select').value }),
      }),
    ),
  );
  document.querySelectorAll('.override-tier-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const select = document.querySelector(`.tier-select[data-cohort-id="${btn.dataset.cohortId}"]`);
      act(() =>
        api(`/api/v1/platform/orgs/${orgId}/override-tier`, {
          method: 'POST',
          body: JSON.stringify({ cohort_id: btn.dataset.cohortId, new_tier: select.value }),
        }),
      );
    });
  });

  document.querySelectorAll('.impersonate-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const reason = prompt(`Reason for impersonating ${btn.dataset.email}? (required)`);
      if (!reason || !reason.trim()) return;
      try {
        const result = await api('/api/v1/impersonation/start', {
          method: 'POST',
          body: JSON.stringify({ org_id: orgId, person_id: btn.dataset.personId, reason }),
        });
        const url = new URL(`${ADMIN_WEB_ORIGIN}/impersonate`);
        url.searchParams.set('token', result.session_token);
        url.searchParams.set('mode', result.mode);
        url.searchParams.set('org_name', result.target.org_name);
        url.searchParams.set('email', result.target.email);
        window.open(url.toString(), '_blank');
      } catch (err) {
        await renderOrgDetail(orgId, { error: err.message });
      }
    });
  });
}

renderLogin();
