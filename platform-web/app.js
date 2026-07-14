import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js';
import {
  getAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
} from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js';

const API_BASE = window.DAPROVA_API_BASE || 'http://localhost:4001';
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
        ${error ? `<p class="error">${error}</p>` : ''}
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

  render(`
    <h1>Daprova Platform</h1>

    <h2>Signup fraud review</h2>
    <p class="muted">docs/org-onboarding-spec.md §7.2 — a match doesn't block signup, it just lands here for review.</p>
    <div class="card">
      ${flagsError ? `<p class="error">${flagsError}</p>` : ''}
      ${status?.flagError ? `<p class="error">${status.flagError}</p>` : ''}
      <table>
        <thead><tr><th>New org</th><th>Matches</th><th>Reason</th><th>Flagged</th><th></th></tr></thead>
        <tbody>
          ${pendingFlags
            .map(
              (f) => `
            <tr data-flag-id="${f.id}">
              <td>${f.org_name}</td>
              <td>${f.matched_org_name}</td>
              <td>${f.match_reason}</td>
              <td>${new Date(f.created_at).toLocaleDateString()}</td>
              <td>
                <button class="review-btn" data-id="${f.id}" data-decision="approved">Approve</button>
                <button class="review-btn" data-id="${f.id}" data-decision="rejected">Reject</button>
              </td>
            </tr>`,
            )
            .join('') || '<tr><td colspan="5" class="muted">No flagged signups pending review.</td></tr>'}
        </tbody>
      </table>
    </div>

    <h2>Organisations</h2>
    <div class="card">
      ${loadError ? `<p class="error">${loadError}</p>` : ''}
      <table>
        <thead><tr><th>Name</th><th>Slug</th><th>Contact</th><th>Billing status</th><th>Created</th><th></th></tr></thead>
        <tbody>
          ${orgs
            .map(
              (o) => `
            <tr>
              <td>${o.name}${o.deleted_at ? ' <span class="muted">(closed)</span>' : ''}</td>
              <td>${o.slug}</td><td>${o.contact_email}</td><td>${o.billing_status ?? ''}</td>
              <td>${new Date(o.created_at).toLocaleDateString()}</td>
              <td><button class="manage-btn" data-id="${o.id}">Manage</button></td>
            </tr>`,
            )
            .join('') || '<tr><td colspan="6" class="muted">No organisations yet.</td></tr>'}
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
        ${status?.error ? `<p class="error">${status.error}</p>` : ''}
        ${status?.success ? `<p class="muted">Created: ${status.success}</p>` : ''}
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
    render(`<h1>Daprova Platform</h1><p class="error">${err.message}</p><button id="back-btn">Back</button>`);
    document.getElementById('back-btn').addEventListener('click', () => renderMain());
    return;
  }

  const isSuspended = org.billing_status === 'suspended';

  render(`
    <h1>Daprova Platform</h1>
    <button id="back-btn">&larr; Back to organisations</button>
    <h2>${org.name} ${org.deleted_at ? '<span class="muted">(closed)</span>' : ''}</h2>
    <div class="card">
      <p><strong>Slug:</strong> ${org.slug} &nbsp; <strong>Billing status:</strong> ${org.billing_status} &nbsp;
         <strong>Free trial used:</strong> ${org.has_used_free_trial ? 'yes' : 'no'} &nbsp;
         <strong>Signup review:</strong> ${org.signup_review_status ?? 'none'}</p>
      ${status?.error ? `<p class="error">${status.error}</p>` : ''}
      ${status?.success ? `<p class="muted">${status.success}</p>` : ''}
      <div class="actions">
        ${
          isSuspended
            ? '<button id="reactivate-btn">Reactivate org</button>'
            : '<button id="suspend-btn">Suspend org</button>'
        }
        <button id="extend-trial-btn">Grant free-trial exception</button>
        <button id="close-org-btn">Close org</button>
      </div>
    </div>

    <h3>Members</h3>
    <div class="card">
      <table>
        <thead><tr><th>Email</th><th>Name</th><th>Role</th></tr></thead>
        <tbody>
          ${org.members.map((m) => `<tr><td>${m.email}</td><td>${m.display_name ?? ''}</td><td>${m.role}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No members.</td></tr>'}
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
              <td>${c.name}</td><td>${c.status}</td><td>${c.student_count}</td><td>${c.plan_tier_at_creation ?? '(none)'}</td>
              <td>
                <select class="tier-select" data-cohort-id="${c.id}">
                  ${['FREE_TRIAL', 'ENTRY', 'GROWTH', 'SCALE_1', 'SCALE_2', 'ENTERPRISE'].map((t) => `<option value="${t}">${t}</option>`).join('')}
                </select>
                <button class="override-tier-btn" data-cohort-id="${c.id}">Override</button>
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
}

renderLogin();
