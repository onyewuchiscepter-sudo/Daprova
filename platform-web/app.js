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

  render(`
    <h1>Daprova Platform</h1>
    <h2>Organisations</h2>
    <div class="card">
      ${loadError ? `<p class="error">${loadError}</p>` : ''}
      <table>
        <thead><tr><th>Name</th><th>Slug</th><th>Contact</th><th>Created</th></tr></thead>
        <tbody>
          ${orgs
            .map(
              (o) =>
                `<tr><td>${o.name}</td><td>${o.slug}</td><td>${o.contact_email}</td><td>${new Date(o.created_at).toLocaleDateString()}</td></tr>`,
            )
            .join('') || '<tr><td colspan="4" class="muted">No organisations yet.</td></tr>'}
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
}

renderLogin();
