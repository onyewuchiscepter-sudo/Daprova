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
// Who is signed in (platform_role decides which buttons are shown; the API
// enforces the same split, so hiding is only a courtesy).
let me = null;
const isOwner = () => me?.platform_role === 'owner';

async function api(path, opts = {}) {
  const headers = new Headers(opts.headers);
  headers.set('Content-Type', 'application/json');
  if (sessionToken) headers.set('Authorization', `Bearer ${sessionToken}`);
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `Request failed: ${res.status}`);
  return body;
}
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body ?? {}) });

// Everything here is signup-supplied (org names, addresses, emails...) and
// gets written into innerHTML — escape every value, or a crafted org name
// runs script inside a platform admin's session.
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

const TIER_LABEL = { starter: 'Starter', growth: 'Growth', scale: 'Scale', enterprise: 'Enterprise' };
const INVOICE_KIND = { monthly_base: 'Monthly base', cohort_cycle_base: 'Cycle base', cohort_completion: 'Assessments', report_overage: 'Extra report' };
const naira = (v) => (v === null || v === undefined ? '—' : '₦' + Number(v).toLocaleString('en-NG', { maximumFractionDigits: 2 }));
const day = (v) => (v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const when = (v) => (v ? new Date(v).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const badge = (text, tone = '') => `<span class="badge ${tone}">${esc(text)}</span>`;
const STATUS_TONE = { paid: 'verified', pending: 'pending', overdue: 'banned', void: '', active: 'verified', suspended: 'banned', pending_manual_quote: 'pending', verified: 'verified', banned: 'banned' };
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const on = (sel, ev, fn) => $$(sel).forEach((el) => el.addEventListener(ev, (e) => fn(e, el)));
const flash = (status) =>
  status?.error ? `<p class="error">${esc(status.error)}</p>` : status?.success ? `<p class="success">${esc(status.success)}</p>` : '';

// ------------------------------------------------------------------ shell

const TABS = [
  ['overview', 'Overview'],
  ['orgs', 'Organisations'],
  ['invoices', 'Invoices'],
  ['payments', 'Payments'],
  ['review', 'Review'],
  ['announcements', 'Announcements'],
  ['team', 'Team'],
  ['activity', 'Activity'],
];
let currentTab = 'overview';

function shell(content, active = currentTab) {
  app.innerHTML = `
    <header class="top">
      <span class="brand"><img src="/daprova-mark.svg" alt="" width="20" height="20"> Daprova Platform</span>
      <span class="muted">${esc(me?.email)} · ${esc(me?.platform_role)}</span>
    </header>
    <nav class="tabs">${TABS.map(([k, label]) => `<button class="tab${k === active ? ' active' : ''}" data-tab="${k}">${label}</button>`).join('')}</nav>
    <div id="content">${content}</div>`;
  on('.tab', 'click', (_e, el) => go(el.dataset.tab));
}

async function go(tab, status) {
  currentTab = tab;
  shell('<p class="muted">Loading…</p>', tab);
  const view = { overview, orgs: orgsTab, invoices: invoicesTab, payments: paymentsTab, review: reviewTab, announcements: announcementsTab, team: teamTab, activity: activityTab }[tab];
  try {
    await view(status);
  } catch (err) {
    shell(`<p class="error">${esc(err.message)}</p>`, tab);
  }
}

// Status and money actions must say why (the API refuses otherwise); the
// reason is kept in the activity log. Returns null if cancelled.
function askReason(question) {
  const answer = prompt(`${question}\n\nReason (required, kept in the activity log):`);
  if (answer === null) return null;
  if (answer.trim().length < 3) {
    alert('Please give a reason of at least 3 characters.');
    return null;
  }
  return answer.trim();
}

// Runs an action, then re-renders with its outcome.
async function act(fn, rerender, successText = 'Done.') {
  try {
    const result = await fn();
    await rerender({ success: typeof successText === 'function' ? successText(result) : successText });
  } catch (err) {
    await rerender({ error: err.message });
  }
}

// ------------------------------------------------------------------ login

function renderLogin(error) {
  app.innerHTML = `
    <h1>Daprova Platform</h1>
    <div class="card narrow">
      <form id="login-form">
        <label>Email<input type="email" id="email" required autocomplete="username" /></label>
        <label>Password<input type="password" id="password" required autocomplete="current-password" /></label>
        ${error ? `<p class="error">${esc(error)}</p>` : ''}
        <button type="submit">Sign in</button>
      </form>
    </div>`;
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const cred = await signInWithEmailAndPassword(auth, $('#email').value, $('#password').value);
      const idToken = await cred.user.getIdToken();
      // A staff session with no organisation attached, so the console never
      // depends on the state of any org the person also belongs to.
      const result = await api('/api/v1/auth/verify?platform=1', { method: 'POST', headers: { Authorization: `Bearer ${idToken}` } });
      sessionToken = result.session_token;
      me = await api('/api/v1/platform/me');
      await go('overview');
    } catch (err) {
      sessionToken = null;
      renderLogin(err.message);
    }
  });
}

// ------------------------------------------------------------------ overview

async function overview() {
  const o = await api('/api/v1/platform/overview');
  const r = o.revenue;
  const max = Math.max(1, ...r.by_month.map((m) => m.total));
  const stat = (label, value, sub = '') => `<div class="stat"><span class="stat-k">${esc(label)}</span><span class="stat-v">${value}</span>${sub ? `<span class="muted">${sub}</span>` : ''}</div>`;
  shell(`
    <h2>Money</h2>
    <div class="stats">
      ${stat('Collected this month', esc(naira(r.paid_this_month)), `Last month ${esc(naira(r.paid_last_month))}`)}
      ${stat('Collected this year', esc(naira(r.paid_this_year)), `All time ${esc(naira(r.paid_all_time))}`)}
      ${stat('Recurring base fees', esc(naira(r.monthly_recurring)) + '<small>/mo</small>', 'Monthly-billed orgs past their trial')}
      ${stat('Awaiting payment', esc(naira(o.receivables.pending_total)), `${o.receivables.pending_count} invoice(s), not yet due`)}
      ${stat('Overdue', `<span class="${o.receivables.overdue_count ? 'bad' : ''}">${esc(naira(o.receivables.overdue_total))}</span>`, `${o.receivables.overdue_count} invoice(s) · ${o.receivables.blocked_orgs} org(s) blocked`)}
    </div>
    <div class="card">
      <p class="muted">Collected per month (last 6 months)</p>
      ${
        r.by_month.length
          ? `<div class="bars">${r.by_month
              .map((m) => `<div class="bar-col"><span class="bar-v">${esc(naira(m.total))}</span><div class="bar" style="height:${Math.max(2, (m.total / max) * 100)}%"></div><span class="bar-l">${esc(m.month)}</span></div>`)
              .join('')}</div>`
          : '<p class="muted">No payments collected yet.</p>'
      }
    </div>

    <h2>Organisations</h2>
    <div class="stats">
      ${stat('Organisations', o.orgs.total, `${o.orgs.new_last_30_days} new in 30 days`)}
      ${stat('In free trial', o.orgs.in_trial)}
      ${Object.entries(o.orgs.by_tier).map(([t, n]) => stat(TIER_LABEL[t] ?? t, n)).join('')}
    </div>
    <div class="stats">
      ${stat('Awaiting verification', o.orgs.awaiting_verification, o.orgs.awaiting_verification ? '<a href="#" data-go="review">Review</a>' : '')}
      ${stat('Fraud flags to review', o.to_review.fraud_flags, o.to_review.fraud_flags ? '<a href="#" data-go="review">Review</a>' : '')}
      ${stat('Suspended', o.orgs.by_billing_status.suspended ?? 0)}
      ${stat('Waiting for a quote', o.orgs.by_billing_status.pending_manual_quote ?? 0, 'Enterprise-size, need pricing')}
    </div>

    <h2>Usage, last 30 days</h2>
    <div class="stats">
      ${stat('Learners assessed', o.usage_last_30_days.learners_assessed)}
      ${stat('Cohorts created', o.usage_last_30_days.cohorts_created)}
      ${stat('Funder reports', o.usage_last_30_days.reports_generated)}
    </div>
    ${isOwner() ? '<p><button class="secondary" id="run-billing-btn">Run billing job now</button> <span class="muted">Normally runs every hour: marks overdue invoices, issues monthly invoices, re-checks plans, auto-finalises cohorts.</span></p><div id="run-billing-out"></div>' : ''}
  `);
  on('[data-go]', 'click', (e, el) => {
    e.preventDefault();
    go(el.dataset.go);
  });
  $('#run-billing-btn')?.addEventListener('click', async () => {
    const out = $('#run-billing-out');
    try {
      const r = await post('/api/v1/platform/billing/run');
      out.innerHTML = `<p class="success">Billing job ran: ${esc(r.overdue_marked)} marked overdue, ${esc(r.periods_rolled)} monthly period(s) invoiced, ${esc(r.tier_changes)} plan change(s), ${esc(r.cohorts_finalized)} cohort(s) auto-finalised, ${esc(r.errors)} error(s).</p>`;
    } catch (err) {
      out.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    }
  });
}

// ------------------------------------------------------------------ organisations

let orgFilters = { q: '', tier: '', status: '', verification: '', show_closed: false, sort: 'created' };

async function orgsTab(status) {
  const orgs = await api('/api/v1/platform/orgs');
  const draw = () => {
    const f = orgFilters;
    const q = f.q.trim().toLowerCase();
    let rows = orgs.filter(
      (o) =>
        (f.show_closed || !o.deleted_at) &&
        (!q || [o.name, o.slug, o.contact_email].some((v) => String(v ?? '').toLowerCase().includes(q))) &&
        (!f.tier || o.pricing_tier === f.tier) &&
        (!f.status || (f.status === 'overdue' ? o.has_overdue : f.status === 'trial' ? !o.billing_started_at : o.billing_status === f.status)) &&
        (!f.verification || o.verification_status === f.verification),
    );
    const sorters = {
      created: (a, b) => new Date(b.created_at) - new Date(a.created_at),
      name: (a, b) => a.name.localeCompare(b.name),
      outstanding: (a, b) => Number(b.outstanding_ngn) - Number(a.outstanding_ngn),
      login: (a, b) => new Date(b.last_login_at ?? 0) - new Date(a.last_login_at ?? 0),
    };
    rows = rows.sort(sorters[f.sort]);
    $('#org-rows').innerHTML =
      rows
        .map(
          (o) => `
        <tr class="clickable" data-id="${esc(o.id)}">
          <td><strong>${esc(o.name)}</strong>${o.deleted_at ? ' <span class="muted">(closed)</span>' : ''}<br><span class="muted">${esc(o.contact_email)}</span></td>
          <td>${esc(TIER_LABEL[o.pricing_tier] ?? o.pricing_tier)}${o.is_enterprise_custom ? ' (custom)' : ''}<br><span class="muted">${o.billing_frequency === 'per_cohort_cycle' ? 'per cohort' : 'monthly'}${o.billing_started_at ? '' : ' · trial'}</span></td>
          <td>${badge(o.billing_status.replace(/_/g, ' '), STATUS_TONE[o.billing_status])} ${badge(o.verification_status, STATUS_TONE[o.verification_status])}</td>
          <td class="num">${Number(o.outstanding_ngn) ? `<span class="${o.has_overdue ? 'bad' : ''}">${esc(naira(o.outstanding_ngn))}</span>` : '—'}${Number(o.credit_ngn) ? `<br><span class="muted">credit ${esc(naira(o.credit_ngn))}</span>` : ''}</td>
          <td class="num">${esc(o.member_count)} / ${esc(o.cohort_count)}</td>
          <td>${esc(day(o.last_login_at))}</td>
          <td>${esc(day(o.created_at))}</td>
        </tr>`,
        )
        .join('') || '<tr><td colspan="7" class="muted">No organisations match.</td></tr>';
    $('#org-count').textContent = `${rows.length} of ${orgs.length}`;
    on('#org-rows tr.clickable', 'click', (_e, el) => orgDetail(el.dataset.id));
  };

  const opt = (value, label, current) => `<option value="${value}" ${value === current ? 'selected' : ''}>${label}</option>`;
  shell(`
    ${flash(status)}
    <div class="filters">
      <input id="f-q" placeholder="Search name, slug or email" value="${esc(orgFilters.q)}">
      <select id="f-tier">${opt('', 'All plans', orgFilters.tier)}${Object.entries(TIER_LABEL).map(([k, v]) => opt(k, v, orgFilters.tier)).join('')}</select>
      <select id="f-status">${[['', 'Any billing'], ['active', 'Active'], ['trial', 'In free trial'], ['overdue', 'Has overdue invoice'], ['pending_manual_quote', 'Waiting for quote'], ['suspended', 'Suspended']].map(([k, v]) => opt(k, v, orgFilters.status)).join('')}</select>
      <select id="f-verification">${[['', 'Any verification'], ['pending', 'Pending'], ['verified', 'Verified'], ['banned', 'Banned']].map(([k, v]) => opt(k, v, orgFilters.verification)).join('')}</select>
      <select id="f-sort">${[['created', 'Newest first'], ['name', 'Name'], ['outstanding', 'Most owed'], ['login', 'Last active']].map(([k, v]) => opt(k, v, orgFilters.sort)).join('')}</select>
      <label class="inline"><input type="checkbox" id="f-closed" ${orgFilters.show_closed ? 'checked' : ''}> Show closed</label>
      <span class="muted" id="org-count"></span>
    </div>
    <div class="card flush">
      <table>
        <thead><tr><th>Organisation</th><th>Plan</th><th>Status</th><th>Owes</th><th>Members / cohorts</th><th>Last login</th><th>Joined</th></tr></thead>
        <tbody id="org-rows"></tbody>
      </table>
    </div>

    ${isOwner() ? `<h2>Create an organisation</h2>
    <p class="muted">For deals set up by the Daprova team. The org is created verified. Leave the password empty and the admin gets an email to choose their own (recommended).</p>
    <div class="card">
      <form id="create-org-form" class="grid2">
        <label>Organisation name<input id="org_name" required /></label>
        <label>Slug<input id="org_slug" required placeholder="acme-edtech" pattern="[a-z0-9-]+" /></label>
        <label>Contact email<input type="email" id="contact_email" required /></label>
        <label>Admin full name<input id="admin_display_name" /></label>
        <label>Admin email<input type="email" id="admin_email" required /></label>
        <label>Admin password (optional)<input type="password" id="admin_password" minlength="8" autocomplete="new-password" /></label>
        <div><button type="submit">Create organisation</button></div>
      </form>
    </div>` : ''}`);
  draw();
  const bind = (id, key, ev = 'change') =>
    $(id).addEventListener(ev, (e) => {
      orgFilters[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      draw();
    });
  bind('#f-q', 'q', 'input');
  bind('#f-tier', 'tier');
  bind('#f-status', 'status');
  bind('#f-verification', 'verification');
  bind('#f-sort', 'sort');
  bind('#f-closed', 'show_closed');
  $('#org_name')?.addEventListener('input', (e) => {
    const slug = $('#org_slug');
    if (!slug.dataset.touched) slug.value = e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  });
  $('#org_slug')?.addEventListener('input', (e) => (e.target.dataset.touched = '1'));
  $('#create-org-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const body = {
      org_name: $('#org_name').value,
      org_slug: $('#org_slug').value,
      contact_email: $('#contact_email').value,
      admin_display_name: $('#admin_display_name').value || undefined,
      admin_email: $('#admin_email').value,
      admin_password: $('#admin_password').value || undefined,
    };
    act(
      () => post('/api/v1/platform/orgs', body),
      orgsTab,
      (r) => `Created ${r.org.name}. ${r.password_email_sent ? `${r.admin.email} has been emailed a link to set their password.` : `Send ${r.admin.email} their login yourself.`}`,
    );
  });
}

// ------------------------------------------------------------------ org detail

async function orgDetail(orgId, status) {
  currentTab = 'orgs';
  let org, activity;
  try {
    [org, activity] = await Promise.all([api(`/api/v1/platform/orgs/${orgId}`), api(`/api/v1/platform/activity?org_id=${orgId}`)]);
  } catch (err) {
    shell(`<p class="error">${esc(err.message)}</p><button class="secondary" id="back-btn">Back</button>`, 'orgs');
    $('#back-btn').addEventListener('click', () => go('orgs'));
    return;
  }
  const b = org.billing;
  const owner = isOwner();
  const rerender = (s) => orgDetail(orgId, s);
  const isSuspended = org.billing_status === 'suspended';
  const isBanned = org.verification_status === 'banned';
  const admin = org.members.find((m) => m.role === 'admin') ?? org.members[0];

  shell(`
    <p><a href="#" id="back-link">← All organisations</a></p>
    <div class="title-row">
      <h1>${esc(org.name)}</h1>
      <span>${badge(org.billing_status.replace(/_/g, ' '), STATUS_TONE[org.billing_status])} ${badge(org.verification_status, STATUS_TONE[org.verification_status])} ${org.deleted_at ? badge('closed', 'banned') : ''}</span>
    </div>
    <p class="muted">${esc(org.slug)} · joined ${esc(day(org.created_at))} · ${esc(org.contact_email)}</p>
    ${owner ? '' : '<p class="muted">You have support access: you can view, verify, send reminders and password resets, and impersonate read-only. Changes to status, money, pricing and members need an owner.</p>'}
    ${flash(status)}

    <div class="card">
      <div class="actions">
        ${org.verification_status === 'pending' ? '<button id="verify-btn">Verify</button>' : ''}
        ${owner && !org.deleted_at ? (isSuspended ? '<button id="reactivate-btn">Reactivate</button>' : '<button class="danger" id="suspend-btn">Suspend</button>') : ''}
        ${owner && !isBanned ? '<button class="danger" id="ban-btn">Ban</button>' : ''}
        ${owner && !org.deleted_at ? '<button class="danger" id="close-org-btn">Close org</button>' : ''}
        ${owner && org.deleted_at && !isBanned ? '<button id="reopen-btn">Reopen org</button>' : ''}
      </div>
      ${owner ? `
      <form id="profile-form" class="grid3">
        <label>Name<input id="p-name" value="${esc(org.name)}" required></label>
        <label>Contact / billing email<input id="p-email" type="email" value="${esc(org.contact_email)}" required></label>
        <div><button class="secondary" type="submit">Save details</button></div>
      </form>` : ''}
    </div>

    <h2>Plan &amp; pricing</h2>
    <div class="card">
      <p><strong>${esc(b.tier.display_name)}</strong>${org.is_enterprise_custom ? ' (custom agreement)' : ''} since ${esc(day(b.tier_effective_date))} · billed ${esc(b.billing_frequency === 'monthly' ? 'monthly' : 'per cohort')} · pricing ${esc(b.pricing_version)}</p>
      <p>Learners in the last 12 months: <strong>${esc(b.volume.trailing_12_months)}</strong> (fits ${esc(TIER_LABEL[b.volume.tier_by_volume])}) · projected ${esc(b.volume.projected ?? '—')} / year
        ${b.pending_tier ? ` · <strong>moves to ${esc(TIER_LABEL[b.pending_tier])} at renewal</strong>` : ''}</p>
      <p>Open cohorts ${esc(b.cohorts.open)} / ${esc(b.cohorts.limit ?? '∞')} · reports this year ${esc(b.quota.used)} / ${esc(b.quota.included ?? '∞')} ·
        ${b.trial.active ? `free trial (${esc(org.free_cohorts_remaining)} free cohort(s) left)` : `billing since ${esc(day(org.billing_started_at))}`}
        ${b.blocked ? ` · <span class="bad">blocked by ${esc(b.blocked.invoice_number)}</span>` : ''}</p>
      ${owner ? `
      <details>
        <summary>Change plan or pricing</summary>
        <p class="muted">A manual plan change applies now; at the next renewal the plan follows actual volume again unless the org is on a custom Enterprise agreement.</p>
        <div class="grid3">
          <label>Plan<select id="pricing-tier">${Object.entries(TIER_LABEL).map(([k, v]) => `<option value="${k}" ${k === org.pricing_tier ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label>Billing<select id="pricing-frequency">${[['monthly', 'Monthly'], ['per_cohort_cycle', 'Per cohort']].map(([k, v]) => `<option value="${k}" ${k === org.billing_frequency ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label>Projected learners / year<input id="pricing-projected" type="number" min="0" value="${esc(org.projected_students_per_year ?? '')}"></label>
        </div>
        <label class="inline"><input id="pricing-custom" type="checkbox" ${org.is_enterprise_custom ? 'checked' : ''}> Custom Enterprise agreement</label>
        <label>Custom pricing JSON (Enterprise only; overrides tier fields, e.g. {"base_fee_monthly_ngn": 450000, "funder_reports_included_per_year": 40})
          <textarea id="pricing-custom-json" rows="3">${esc(org.custom_pricing_json ? JSON.stringify(org.custom_pricing_json) : '')}</textarea></label>
        <label>Reason for the change (required)<input id="pricing-reason" minlength="3" placeholder="e.g. Signed Enterprise agreement 12 Sept"></label>
        <button id="save-pricing-btn">Save pricing</button>
      </details>
      <div class="actions">
        <button class="secondary" id="extend-trial-btn">Grant a free cohort</button>
        <label class="inline">Billing status
          <select id="billing-status-select">${['active', 'pending_manual_quote', 'suspended'].map((s) => `<option value="${s}" ${s === org.billing_status ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`).join('')}</select>
        </label>
        <button class="secondary" id="correct-billing-btn">Set status</button>
      </div>` : ''}
    </div>

    <h2>Credit</h2>
    <div class="card">
      <p>Balance: <strong>${esc(naira(org.credit_ngn))}</strong> <span class="muted">— used automatically against the next invoices.</span></p>
      ${owner ? `
      <form id="credit-form" class="grid3">
        <label>Amount (₦, negative to remove)<input id="credit-amount" type="number" step="0.01" required></label>
        <label>Reason<input id="credit-reason" required minlength="3" placeholder="e.g. Prepaid by bank transfer"></label>
        <div><button class="secondary" type="submit">Apply</button></div>
      </form>` : ''}
    </div>

    <h2>Invoices</h2>
    <div class="card flush">${invoiceTable(org.invoices, { showOrg: false })}</div>

    <h2>Members</h2>
    <div class="card flush">
      <table>
        <thead><tr><th>Person</th><th>Role</th><th>Last login</th><th></th></tr></thead>
        <tbody>
          ${org.members
            .map(
              (m) => `<tr>
              <td>${esc(m.display_name ?? '')}<br><span class="muted">${esc(m.email)}</span></td>
              <td>${
                owner
                  ? `<select class="member-role" data-mid="${esc(m.membership_id)}">${['admin', 'viewer'].map((r) => `<option ${r === m.role ? 'selected' : ''}>${r}</option>`).join('')}</select>`
                  : esc(m.role)
              }</td>
              <td>${esc(day(m.last_login_at))}</td>
              <td class="actions">
                <button class="secondary small reset-btn" data-mid="${esc(m.membership_id)}" data-email="${esc(m.email)}">Send password reset</button>
                <button class="secondary small impersonate-btn" data-person-id="${esc(m.id)}" data-email="${esc(m.email)}">Impersonate</button>
                ${owner ? `<button class="danger small remove-member-btn" data-mid="${esc(m.membership_id)}" data-email="${esc(m.email)}">Remove</button>` : ''}
              </td></tr>`,
            )
            .join('') || '<tr><td colspan="4" class="muted">No members.</td></tr>'}
        </tbody>
      </table>
      <p class="muted pad">Impersonation needs a reason and every action is logged. Write or read-only access comes from your own platform role.</p>
    </div>
    <div class="card">
      <p><strong>Pending invites</strong></p>
      <table><tbody>
        ${org.invites
          .map(
            (i) => `<tr><td>${esc(i.email)}</td><td>${esc(i.role)}</td><td>${new Date(i.expires_at) < new Date() ? '<span class="bad">expired</span>' : `expires ${esc(day(i.expires_at))}`}</td>
            <td class="actions"><button class="secondary small resend-invite-btn" data-id="${esc(i.id)}">Resend</button>${owner ? ` <button class="danger small revoke-invite-btn" data-id="${esc(i.id)}">Revoke</button>` : ''}</td></tr>`,
          )
          .join('') || '<tr><td class="muted">None.</td></tr>'}
      </tbody></table>
      ${owner ? `
      <form id="invite-form" class="grid3">
        <label>Invite someone<input id="invite-email" type="email" placeholder="name@organisation.org" required></label>
        <label>Role<select id="invite-role"><option>admin</option><option>viewer</option></select></label>
        <div><button class="secondary" type="submit">Send invite</button></div>
      </form>` : ''}
    </div>

    <h2>Cohorts</h2>
    <div class="card flush">
      <table>
        <thead><tr><th>Name</th><th>Status</th><th>Students</th><th>Free trial</th><th>Finalised</th></tr></thead>
        <tbody>
          ${org.cohorts
            .map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.status)}</td><td>${esc(c.student_count)}</td><td>${c.is_free_trial ? 'yes' : ''}</td><td>${esc(c.finalized_at ? day(c.finalized_at) : '')}</td></tr>`)
            .join('') || '<tr><td colspan="5" class="muted">No cohorts.</td></tr>'}
        </tbody>
      </table>
    </div>

    <h2>Registration details</h2>
    <div class="card">
      <table><tbody>
        <tr><td>Organisation type</td><td>${esc(org.org_type ?? '')}</td></tr>
        <tr><td>CAC registration number</td><td>${esc(org.cac_registration_number ?? '')}</td></tr>
        <tr><td>Website / social link</td><td>${esc(org.website_url ?? '')}</td></tr>
        <tr><td>Address</td><td>${esc(org.address ?? '')}</td></tr>
        <tr><td>Primary use case</td><td>${esc(org.primary_use_case ?? '')}</td></tr>
        <tr><td>Expected cadence</td><td>${esc(org.expected_cadence ?? '')}</td></tr>
        <tr><td>Reports to funder</td><td>${org.reports_to_funder ? `yes (${esc(org.reports_to_funder_name ?? 'unnamed')})` : 'no'}</td></tr>
        <tr><td>Referral source</td><td>${esc(org.referral_source ?? '')}</td></tr>
        <tr><td>Signup review</td><td>${esc(org.signup_review_status ?? 'none')}</td></tr>
        <tr><td>Admin at signup</td><td>${esc(admin?.display_name ?? '')} ${admin?.title ? `(${esc(admin.title)})` : ''} · ${esc(admin?.email ?? '')} · ${esc(admin?.phone ?? '')}</td></tr>
      </tbody></table>
    </div>

    <h2>Recent activity</h2>
    <div class="card flush">${activityTable(activity.entries.slice(0, 25), { showOrg: false })}</div>
  `, 'orgs');

  $('#back-link').addEventListener('click', (e) => {
    e.preventDefault();
    go('orgs');
  });
  const call = (path, body, msg) => act(() => post(`/api/v1/platform/orgs/${orgId}${path}`, body), rerender, msg);
  $('#verify-btn')?.addEventListener('click', () => call('/verify', null, 'Verified.'));
  const withReason = (question, path, msg) => {
    const reason = askReason(question);
    if (reason) call(path, { reason }, msg);
  };
  $('#suspend-btn')?.addEventListener('click', () => withReason(`Suspend ${org.name}? Its users lose access immediately until reactivated.`, '/suspend', 'Suspended.'));
  $('#reactivate-btn')?.addEventListener('click', () => withReason(`Reactivate ${org.name}?`, '/reactivate', 'Reactivated.'));
  $('#ban-btn')?.addEventListener('click', () => withReason(`Ban ${org.name}? This is permanent — the org is closed and can never be reopened.`, '/ban', 'Banned.'));
  $('#close-org-btn')?.addEventListener('click', () => withReason(`Close ${org.name}? Its users lose access immediately. Data is kept and you can reopen it.`, '/close', 'Closed.'));
  $('#reopen-btn')?.addEventListener('click', () => withReason(`Reopen ${org.name}?`, '/reopen', 'Reopened.'));
  $('#extend-trial-btn')?.addEventListener('click', () => withReason(`Give ${org.name} another free cohort?`, '/extend-free-trial', 'Their next cohort is free.'));
  $('#correct-billing-btn')?.addEventListener('click', () => {
    const status = $('#billing-status-select').value;
    const reason = askReason(`Set billing status to "${status.replace(/_/g, ' ')}"?`);
    if (reason) call('/billing-status', { status, reason }, 'Billing status updated.');
  });
  $('#profile-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    act(() => api(`/api/v1/platform/orgs/${orgId}`, { method: 'PATCH', body: JSON.stringify({ name: $('#p-name').value, contact_email: $('#p-email').value }) }), rerender, 'Details saved.');
  });
  $('#save-pricing-btn')?.addEventListener('click', () => {
    const raw = $('#pricing-custom-json').value.trim();
    let custom = null;
    if (raw) {
      try {
        custom = JSON.parse(raw);
      } catch {
        rerender({ error: 'Custom pricing JSON is not valid JSON.' });
        return;
      }
    }
    const projected = $('#pricing-projected').value;
    const reason = $('#pricing-reason').value.trim();
    if (reason.length < 3) {
      rerender({ error: 'Give a reason for the pricing change (at least 3 characters).' });
      return;
    }
    act(
      () =>
        api(`/api/v1/platform/orgs/${orgId}/pricing`, {
          method: 'PUT',
          body: JSON.stringify({
            pricing_tier: $('#pricing-tier').value,
            billing_frequency: $('#pricing-frequency').value,
            projected_students_per_year: projected === '' ? null : Number(projected),
            is_enterprise_custom: $('#pricing-custom').checked,
            custom_pricing_json: custom,
            reason,
          }),
        }),
      rerender,
      'Pricing saved.',
    );
  });
  $('#credit-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    call('/credit', { amount: Number($('#credit-amount').value), reason: $('#credit-reason').value }, (r) => `Credit balance is now ${naira(r.credit_ngn)}.`);
  });
  bindInvoiceActions(rerender);
  on('.member-role', 'change', (_e, el) =>
    act(() => api(`/api/v1/platform/orgs/${orgId}/members/${el.dataset.mid}`, { method: 'PUT', body: JSON.stringify({ role: el.value }) }), rerender, 'Role changed.'),
  );
  on('.remove-member-btn', 'click', (_e, el) => {
    if (!confirm(`Remove ${el.dataset.email} from ${org.name}?`)) return;
    act(() => api(`/api/v1/platform/orgs/${orgId}/members/${el.dataset.mid}`, { method: 'DELETE' }), rerender, 'Member removed.');
  });
  on('.reset-btn', 'click', (_e, el) => {
    if (!confirm(`Email ${el.dataset.email} a link to set a new password?`)) return;
    call(`/members/${el.dataset.mid}/password-reset`, null, `Password reset email sent to ${el.dataset.email}.`);
  });
  on('.resend-invite-btn', 'click', (_e, el) => call(`/invites/${el.dataset.id}/resend`, null, 'Invite re-sent with a new link.'));
  on('.revoke-invite-btn', 'click', (_e, el) => act(() => api(`/api/v1/platform/orgs/${orgId}/invites/${el.dataset.id}`, { method: 'DELETE' }), rerender, 'Invite revoked.'));
  $('#invite-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    call('/invites', { email: $('#invite-email').value, role: $('#invite-role').value }, 'Invite sent.');
  });
  on('.impersonate-btn', 'click', async (_e, el) => {
    const reason = prompt(`Reason for impersonating ${el.dataset.email}? (required)`);
    if (!reason || !reason.trim()) return;
    try {
      const result = await post('/api/v1/impersonation/start', { org_id: orgId, person_id: el.dataset.personId, reason });
      const url = new URL(`${ADMIN_WEB_ORIGIN}/impersonate`);
      url.searchParams.set('token', result.session_token);
      url.searchParams.set('mode', result.mode);
      url.searchParams.set('org_name', result.target.org_name);
      url.searchParams.set('email', result.target.email);
      window.open(url.toString(), '_blank');
    } catch (err) {
      rerender({ error: err.message });
    }
  });
}

// ------------------------------------------------------------------ invoices

function invoiceTable(invoices, { showOrg }) {
  const owner = isOwner();
  return `<table>
    <thead><tr><th>Invoice</th>${showOrg ? '<th>Organisation</th>' : ''}<th>For</th><th class="num">Amount</th><th>Due</th><th>Status</th><th></th></tr></thead>
    <tbody>
      ${
        invoices
          .map((i) => {
            const open = i.status === 'pending' || i.status === 'overdue';
            const lines = (i.line_items ?? []).map((l) => `${esc(l.description)}: ${esc(naira(l.amount_ngn))}`).join('<br>');
            return `<tr>
              <td><span class="mono">${esc(i.invoice_number)}</span><br><span class="muted">${esc(day(i.created_at))}</span></td>
              ${showOrg ? `<td><a href="#" class="org-link" data-id="${esc(i.org_id)}">${esc(i.org_name)}</a></td>` : ''}
              <td>${esc(INVOICE_KIND[i.kind] ?? i.kind)}${i.cohort_name ? `<br><span class="muted">${esc(i.cohort_name)}</span>` : ''}<details class="lines"><summary>lines</summary>${lines}</details></td>
              <td class="num">${esc(naira(i.total_ngn))}${Number(i.discount_ngn) ? `<br><span class="muted">−${esc(naira(i.discount_ngn))} off</span>` : ''}</td>
              <td>${open ? esc(day(i.due_date)) + (i.days_past_due ? `<br><span class="bad">${esc(i.days_past_due)} days late</span>` : '') : i.paid_at ? `paid ${esc(day(i.paid_at))}` : '—'}</td>
              <td>${badge(i.status, STATUS_TONE[i.status])}${i.notes ? `<br><span class="muted">${esc(i.notes)}</span>` : ''}</td>
              <td class="actions">${
                open
                  ? `<button class="secondary small inv-btn" data-id="${esc(i.id)}" data-action="remind">Email reminder</button>` +
                    (owner
                      ? ` <button class="secondary small inv-btn" data-id="${esc(i.id)}" data-action="discount" data-total="${esc(i.total_ngn)}">Discount</button>
                         <button class="small inv-btn" data-id="${esc(i.id)}" data-action="mark_paid">Mark paid</button>
                         <button class="danger small inv-btn" data-id="${esc(i.id)}" data-action="void">Void</button>`
                      : '')
                  : ''
              }</td>
            </tr>`;
          })
          .join('') || `<tr><td colspan="${showOrg ? 7 : 6}" class="muted">No invoices.</td></tr>`
      }
    </tbody></table>`;
}

function bindInvoiceActions(rerender) {
  on('.org-link', 'click', (e, el) => {
    e.preventDefault();
    orgDetail(el.dataset.id);
  });
  on('.inv-btn', 'click', (_e, el) => {
    const id = el.dataset.id;
    const action = el.dataset.action;
    if (action === 'remind') {
      if (!confirm('Email this invoice reminder to the organisation’s admins?')) return;
      act(() => post(`/api/v1/platform/invoices/${id}/remind`), rerender, (r) => `Reminder sent to ${r.to.join(', ')}.`);
    } else if (action === 'discount') {
      const amount = Number(prompt(`Amount to take off (₦, up to ${naira(el.dataset.total)}):`));
      if (!amount) return;
      const reason = prompt('Reason (shown on the invoice):');
      if (!reason || reason.trim().length < 3) return;
      act(() => post(`/api/v1/platform/invoices/${id}/discount`, { amount, reason: reason.trim() }), rerender, 'Discount applied.');
    } else {
      const note = askReason(action === 'void' ? 'Void this invoice? The organisation will no longer owe it.' : 'Mark this invoice as paid? Include the bank transfer reference if there is one.');
      if (!note) return;
      act(() => post(`/api/v1/platform/invoices/${id}/settle`, { action, note }), rerender, action === 'void' ? 'Invoice voided.' : 'Marked paid.');
    }
  });
}

let invoiceFilters = { status: 'unpaid', q: '' };
async function invoicesTab(status) {
  const params = new URLSearchParams({ status: invoiceFilters.status, q: invoiceFilters.q });
  const invoices = await api(`/api/v1/platform/invoices?${params}`);
  const total = invoices.reduce((a, i) => a + Number(i.total_ngn), 0);
  shell(`
    ${flash(status)}
    <form class="filters" id="inv-filter">
      <select id="i-status">${[['unpaid', 'Unpaid (pending + overdue)'], ['overdue', 'Overdue'], ['pending', 'Pending'], ['paid', 'Paid'], ['void', 'Void'], ['', 'All']].map(([k, v]) => `<option value="${k}" ${k === invoiceFilters.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <input id="i-q" placeholder="Invoice number or organisation" value="${esc(invoiceFilters.q)}">
      <button class="secondary" type="submit">Filter</button>
      <span class="muted">${invoices.length} invoice(s) · ${esc(naira(total))}</span>
    </form>
    <div class="card flush">${invoiceTable(invoices, { showOrg: true })}</div>`, 'invoices');
  $('#inv-filter').addEventListener('submit', (e) => {
    e.preventDefault();
    invoiceFilters = { status: $('#i-status').value, q: $('#i-q').value.trim() };
    go('invoices');
  });
  $('#i-status').addEventListener('change', () => $('#inv-filter').requestSubmit());
  bindInvoiceActions(invoicesTab);
}

// ------------------------------------------------------------------ payments

async function paymentsTab(status) {
  const [providers, payments] = await Promise.all([api('/api/v1/platform/payments/providers'), api('/api/v1/platform/payments')]);
  const yesNo = (v) => (v ? '✓ keys set' : '✗ not configured');
  shell(`
    ${flash(status)}
    <div class="card">
      <p><strong>New checkouts use:</strong> ${esc(providers.active)}${providers.active === 'stub' ? ' <span class="muted">(test mode — no real money moves; add PAYSTACK_SECRET_KEY or FLUTTERWAVE_SECRET_KEY as API secrets to go live)</span>' : ''}</p>
      <p class="muted">Paystack: ${yesNo(providers.paystack_configured)} · Flutterwave: ${yesNo(providers.flutterwave_configured)} (webhook hash: ${yesNo(providers.flutterwave_webhook_hash_configured)})</p>
      <button class="secondary" id="reconcile-btn">Check pending payments now</button>
      <span class="muted">Runs every minute on its own: asks the gateway about each pending checkout and expires abandoned ones.</span>
    </div>
    <div class="card flush">
      <table>
        <thead><tr><th>Organisation</th><th>Invoice</th><th class="num">Amount</th><th>Gateway</th><th>Status</th><th>Opened</th><th>Paid</th></tr></thead>
        <tbody>
          ${payments
            .map(
              (p) => `<tr><td>${esc(p.org_name)}</td><td class="mono">${esc(p.invoice_number ?? p.purpose ?? '')}</td><td class="num">${esc(naira(p.amount))}</td><td>${esc(p.provider)}</td>
              <td>${badge(p.status, p.status === 'confirmed' ? 'verified' : p.status === 'pending' ? 'pending' : p.status === 'failed' ? 'banned' : '')}${p.failure_reason ? `<br><span class="muted">${esc(p.failure_reason)}</span>` : ''}</td>
              <td>${esc(when(p.created_at))}</td><td>${esc(when(p.paid_at))}</td></tr>`,
            )
            .join('') || '<tr><td colspan="7" class="muted">No payments yet.</td></tr>'}
        </tbody>
      </table>
    </div>`, 'payments');
  $('#reconcile-btn').addEventListener('click', () =>
    act(() => post('/api/v1/platform/payments/reconcile'), paymentsTab, (r) => `Checked ${r.checked} pending payment(s): ${r.resolved} resolved, ${r.errors} error(s).`),
  );
}

// ------------------------------------------------------------------ review

async function reviewTab(status) {
  const [pending, flags] = await Promise.all([api('/api/v1/platform/orgs/pending-verification'), api('/api/v1/platform/fraud-flags')]);
  const open = flags.filter((f) => !f.reviewed_at);
  shell(`
    ${flash(status)}
    <h2>Awaiting verification</h2>
    <p class="muted">Self-serve signups start pending. They can already build frameworks, courses and cohorts, but can't manage a team until verified.</p>
    <div class="card flush">
      <table>
        <thead><tr><th>Organisation</th><th>Type</th><th>CAC number</th><th>Registered</th><th></th></tr></thead>
        <tbody>
          ${pending
            .map(
              (o) => `<tr><td>${esc(o.name)}</td><td>${esc(o.org_type ?? '')}</td><td>${esc(o.cac_registration_number ?? '')}</td><td>${esc(day(o.created_at))}</td>
              <td class="actions"><button class="secondary small open-org" data-id="${esc(o.id)}">Review</button> <button class="small quick-verify" data-id="${esc(o.id)}">Verify</button></td></tr>`,
            )
            .join('') || '<tr><td colspan="5" class="muted">Nobody waiting.</td></tr>'}
        </tbody>
      </table>
    </div>

    <h2>Signup fraud flags</h2>
    <p class="muted">A match with an existing org doesn't block signup; it lands here.</p>
    <div class="card flush">
      <table>
        <thead><tr><th>New org</th><th>Looks like</th><th>Why</th><th>Flagged</th><th></th></tr></thead>
        <tbody>
          ${open
            .map(
              (f) => `<tr><td>${esc(f.org_name)}</td><td>${esc(f.matched_org_name)}</td><td>${esc(f.match_reason)}</td><td>${esc(day(f.created_at))}</td>
              <td class="actions"><button class="small review-btn" data-id="${esc(f.id)}" data-decision="approved">Approve</button> <button class="danger small review-btn" data-id="${esc(f.id)}" data-decision="rejected">Reject</button></td></tr>`,
            )
            .join('') || '<tr><td colspan="5" class="muted">No flags to review.</td></tr>'}
        </tbody>
      </table>
    </div>`, 'review');
  on('.open-org', 'click', (_e, el) => orgDetail(el.dataset.id));
  on('.quick-verify', 'click', (_e, el) => act(() => post(`/api/v1/platform/orgs/${el.dataset.id}/verify`), reviewTab, 'Verified.'));
  on('.review-btn', 'click', (_e, el) => act(() => post(`/api/v1/platform/fraud-flags/${el.dataset.id}/review`, { decision: el.dataset.decision }), reviewTab, 'Recorded.'));
}

// ------------------------------------------------------------------ announcements

async function announcementsTab(status) {
  const [list, orgs] = await Promise.all([api('/api/v1/platform/announcements'), api('/api/v1/platform/orgs')]);
  const owner = isOwner();
  shell(`
    ${flash(status)}
    <p class="muted">Announcements appear as a banner at the top of the organisation app for everyone in the chosen orgs. Optionally, also email each org's admins.</p>
    ${owner ? `
    <div class="card">
      <form id="ann-form">
        <div class="grid3">
          <label>Title<input id="a-title" required minlength="3" maxlength="160" placeholder="Scheduled maintenance on Saturday"></label>
          <label>Style<select id="a-level"><option value="info">Information</option><option value="warning">Warning</option></select></label>
          <label>Who sees it<select id="a-audience"><option value="all">Every organisation</option><option value="tier">Organisations on one plan</option><option value="org">One organisation</option></select></label>
        </div>
        <div class="grid3">
          <label id="a-tier-wrap" hidden>Plan<select id="a-tier">${Object.entries(TIER_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
          <label id="a-org-wrap" hidden>Organisation<select id="a-org">${orgs.filter((o) => !o.deleted_at).map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}</select></label>
          <label>Show until (optional)<input id="a-ends" type="datetime-local"></label>
        </div>
        <label>Message<textarea id="a-body" rows="4" required minlength="3" maxlength="4000"></textarea></label>
        <label class="inline"><input type="checkbox" id="a-email"> Also email the admins of these organisations</label>
        <div><button type="submit">Publish</button></div>
      </form>
    </div>` : ''}
    <div class="card flush">
      <table>
        <thead><tr><th>Announcement</th><th>Audience</th><th>Showing</th><th>Emailed</th><th></th></tr></thead>
        <tbody>
          ${list
            .map(
              (a) => `<tr>
              <td>${badge(a.level, a.level === 'warning' ? 'pending' : '')} <strong>${esc(a.title)}</strong><br><span class="muted pre">${esc(a.body)}</span></td>
              <td>${a.audience === 'all' ? 'Everyone' : a.audience === 'tier' ? `${esc(TIER_LABEL[a.audience_tier] ?? a.audience_tier)} plan` : esc(a.audience_org_name ?? 'One org')}</td>
              <td>${a.is_live ? badge('live', 'verified') : badge('ended')}<br><span class="muted">${esc(day(a.starts_at))} – ${esc(a.ends_at ? day(a.ends_at) : 'no end')}</span></td>
              <td>${esc(a.emailed_count)}</td>
              <td>${owner && a.is_live ? `<button class="secondary small end-ann" data-id="${esc(a.id)}">End now</button>` : ''}</td></tr>`,
            )
            .join('') || '<tr><td colspan="5" class="muted">No announcements yet.</td></tr>'}
        </tbody>
      </table>
    </div>`, 'announcements');
  $('#a-audience')?.addEventListener('change', (e) => {
    $('#a-tier-wrap').hidden = e.target.value !== 'tier';
    $('#a-org-wrap').hidden = e.target.value !== 'org';
  });
  $('#ann-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const audience = $('#a-audience').value;
    const ends = $('#a-ends').value;
    const email = $('#a-email').checked;
    if (email && !confirm('Also email this to the admins of every organisation in the audience?')) return;
    act(
      () =>
        post('/api/v1/platform/announcements', {
          title: $('#a-title').value,
          body: $('#a-body').value,
          level: $('#a-level').value,
          audience,
          audience_tier: audience === 'tier' ? $('#a-tier').value : null,
          audience_org_id: audience === 'org' ? $('#a-org').value : null,
          ends_at: ends ? new Date(ends).toISOString() : null,
          send_email: email,
        }),
      announcementsTab,
      (r) => `Published.${email ? ` Emailed ${r.emailed_count} admin(s).` : ''}`,
    );
  });
  on('.end-ann', 'click', (_e, el) => act(() => post(`/api/v1/platform/announcements/${el.dataset.id}/end`), announcementsTab, 'Ended.'));
}

// ------------------------------------------------------------------ team

async function teamTab(status) {
  const admins = await api('/api/v1/platform/admins');
  const owner = isOwner();
  shell(`
    ${flash(status)}
    <p class="muted"><strong>Owner</strong>: everything, including money, pricing, suspending and staff. <strong>Support</strong>: can view everything, verify orgs, review fraud flags, impersonate, send reminders and password resets, but can't change money, plans, account status or staff.</p>
    <div class="card flush">
      <table>
        <thead><tr><th>Person</th><th>Role</th><th>Last login</th><th>Added</th><th></th></tr></thead>
        <tbody>
          ${admins
            .map(
              (a) => `<tr>
              <td>${esc(a.display_name ?? '')}<br><span class="muted">${esc(a.email)}</span>${a.person_id === me.id ? ' <span class="muted">(you)</span>' : ''}</td>
              <td>${owner ? `<select class="staff-role" data-id="${esc(a.id)}">${['support', 'owner'].map((r) => `<option ${r === a.platform_role ? 'selected' : ''}>${r}</option>`).join('')}</select>` : esc(a.platform_role)}</td>
              <td>${esc(day(a.last_login_at))}</td>
              <td>${esc(day(a.granted_at))}${a.granted_by_email ? `<br><span class="muted">by ${esc(a.granted_by_email)}</span>` : ''}</td>
              <td>${owner && a.person_id !== me.id ? `<button class="danger small remove-staff" data-id="${esc(a.id)}" data-email="${esc(a.email)}">Remove</button>` : ''}</td></tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </div>
    ${owner ? `
    <h2>Add someone</h2>
    <div class="card">
      <p class="muted">If they don't have a Daprova login yet, one is created and Firebase emails them a link to choose their password. Nobody else sees it.</p>
      <form id="staff-form" class="grid3">
        <label>Email<input id="s-email" type="email" required></label>
        <label>Name (optional)<input id="s-name"></label>
        <label>Role<select id="s-role"><option>support</option><option>owner</option></select></label>
        <div><button type="submit">Add to team</button></div>
      </form>
    </div>` : ''}`, 'team');
  on('.staff-role', 'change', (_e, el) => act(() => api(`/api/v1/platform/admins/${el.dataset.id}`, { method: 'PUT', body: JSON.stringify({ role: el.value }) }), teamTab, 'Role changed.'));
  on('.remove-staff', 'click', (_e, el) => {
    if (!confirm(`Remove ${el.dataset.email} from the platform team? Their Daprova login stays; they just lose console access.`)) return;
    act(() => api(`/api/v1/platform/admins/${el.dataset.id}`, { method: 'DELETE' }), teamTab, 'Removed.');
  });
  $('#staff-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    act(
      () => post('/api/v1/platform/admins', { email: $('#s-email').value, role: $('#s-role').value, display_name: $('#s-name').value || undefined }),
      teamTab,
      (r) => `Added ${r.email} as ${r.role}.${r.password_email_sent ? ' They have been emailed a link to set their password.' : ' They can sign in with their existing login.'}`,
    );
  });
}

// ------------------------------------------------------------------ activity

function activityTable(entries, { showOrg }) {
  return `<table>
    <thead><tr><th>When</th><th>Who</th>${showOrg ? '<th>Organisation</th>' : ''}<th>What</th><th>Details</th></tr></thead>
    <tbody>
      ${
        entries
          .map(
            (e) => `<tr>
            <td class="nowrap">${esc(when(e.created_at))}</td>
            <td>${esc(e.actor_email ?? 'system')}<br><span class="muted">${esc(e.actor_context.replace(/_/g, ' '))}</span></td>
            ${showOrg ? `<td>${e.org_id ? `<a href="#" class="org-link" data-id="${esc(e.org_id)}">${esc(e.org_name ?? '')}</a>` : ''}</td>` : ''}
            <td>${esc(e.action.replace(/_/g, ' '))}</td>
            <td class="details">${e.details ? `<code>${esc(JSON.stringify(e.details))}</code>` : ''}</td></tr>`,
          )
          .join('') || `<tr><td colspan="${showOrg ? 5 : 4}" class="muted">Nothing logged.</td></tr>`
      }
    </tbody></table>`;
}

let activityFilters = { action: '', actor: '' };
async function activityTab(status, before) {
  const params = new URLSearchParams();
  if (activityFilters.action) params.set('action', activityFilters.action);
  if (activityFilters.actor) params.set('actor', activityFilters.actor);
  if (before) params.set('before', before);
  const log = await api(`/api/v1/platform/activity?${params}`);
  shell(`
    ${flash(status)}
    <form class="filters" id="act-filter">
      <input id="a-action" placeholder="Action contains… (e.g. invoice, suspend)" value="${esc(activityFilters.action)}">
      <input id="a-actor" placeholder="Person's email contains…" value="${esc(activityFilters.actor)}">
      <button class="secondary" type="submit">Filter</button>
      ${before ? '<button class="secondary" type="button" id="act-newest">Newest</button>' : ''}
    </form>
    <div class="card flush">${activityTable(log.entries, { showOrg: true })}</div>
    ${log.next_before ? '<button class="secondary" id="act-older">Older →</button>' : ''}`, 'activity');
  $('#act-filter').addEventListener('submit', (e) => {
    e.preventDefault();
    activityFilters = { action: $('#a-action').value.trim(), actor: $('#a-actor').value.trim() };
    activityTab();
  });
  $('#act-older')?.addEventListener('click', () => activityTab(null, log.next_before));
  $('#act-newest')?.addEventListener('click', () => activityTab());
  on('.org-link', 'click', (e, el) => {
    e.preventDefault();
    orgDetail(el.dataset.id);
  });
}

renderLogin();
