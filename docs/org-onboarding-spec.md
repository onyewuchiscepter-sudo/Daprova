# Daprova — Organisation Onboarding & Team Management Spec

Status: DRAFT — not yet implemented
Companion to: `Daprova_PRD_Technical_Specification.docx`

## 0. Why this document exists

The original PRD (A2.1, A3.4, B3.3) assumes an organisation already exists and
only specifies how to *invite a user into* one (`POST /api/v1/org/users/invite`).
It never specifies how an organisation itself gets created. That gap was
worked around during deployment with a one-time, secret-gated `/api/v1/bootstrap`
endpoint that explicitly refuses to run a second time — fine for provisioning
the first customer, not a real onboarding system.

This spec covers the missing piece: how additional organisations get created
(self-serve and/or Daprova-provisioned — both designed below, since that
business decision hasn't been made yet), how a second/third user joins an
existing org, and every other gap found while auditing the codebase against
the PRD for this. Nothing in this document has been built.

---

## 1. Two onboarding models

Both models end at the same place — a row in `organisations` and a row in
`users` with `role = 'admin'` — they differ only in *who* triggers it and
*how the admin's login gets created*. Recommend building the shared backend
primitive first (§3), then whichever front door the business decides on.

### Model A — Self-serve signup (EdTech signs itself up)

1. Prospective admin visits a new public page, `/signup` (no auth) — org name,
   their name, work email, password.
2. Client-side: create the Firebase user directly (`createUserWithEmailAndPassword`)
   — same SDK call the login page already uses, just for signup instead of sign-in.
3. Client calls `POST /api/v1/orgs` with the Firebase ID token + org details.
4. Server verifies the ID token (existing `firebaseAuth.verifyIdToken`, no new
   dependency), creates `organisations` + `users` (role `admin`) in one
   transaction, issues a Daprova session the same way `/auth/verify` does today.
5. Admin lands straight in the dashboard, framework-template picker included.

Open question this doesn't answer: anyone can sign up. If that's a concern
(spam orgs, unqualified leads, fraud), the missing piece is a review/approval
gate — e.g. org starts in a `pending` status, dashboard shows limited
functionality until a Daprova team member approves it. Not designed here
because it's a business call, not an engineering one.

### Model B — Daprova-provisioned (internal team creates it)

1. A Daprova team member uses a small internal-only screen (not part of the
   customer-facing admin-web bundle — a separate route behind a platform-level
   secret, or literally a CLI script hitting the API directly) to submit org
   name + the new admin's email.
2. Server creates the `organisations` row and a `users` row with a **pending
   invite** (see §3) rather than an already-active login — there's no
   Firebase account yet, since nobody has entered a password.
3. Invite email goes to the EdTech admin (see §5 for the email-sending gap
   this surfaces) with a link to `/accept-invite/:token`.
4. They set a password there (creates their Firebase account client-side,
   same as signup), which activates the pending `users` row.

This generalizes today's one-time `/api/v1/bootstrap` into a repeatable,
audited action instead of a single-use escape hatch. Realistically this is
the lower-risk model to ship first — it keeps a human in the loop.

**Both models can coexist** — Model B's "create org, invite an admin" and
Model A's "invite a teammate" (§2) are the same underlying primitive.

---

## 2. Inviting a teammate into an *existing* org

Spec'd in the original PRD (`POST /api/v1/org/users/invite`) but never built.
Same mechanics as Model B's invite step above, minus creating a new org:

1. Admin (from a new "Team" settings page — doesn't exist yet, see §6) enters
   an email + role (`admin` or `viewer`).
2. Server creates an `invites` row (see §4), sends an invite email.
3. Invitee clicks the link, sets a password (creates their Firebase account),
   the invite-accept endpoint creates their `users` row against the *existing*
   `org_id` from the invite.

Constraint worth flagging: `users.email` and `users.auth_uid` are globally
unique in the current schema (not scoped per org) — one email can only ever
belong to one organisation, ever. That's fine for the common case but means
someone consulting for two different EdTechs can't use the same login for
both. Worth confirming that's acceptable before building on top of it.

---

## 3. Data model changes

New table, `invites` (next migration after `0002_reports_storage.ts` would be
`0003_org_invites.ts`):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `org_id` | uuid, FK → organisations.id | |
| `email` | varchar(255) | invitee's email |
| `role` | varchar(50), check `admin`/`viewer` | |
| `token` | varchar(255), unique | random, single-use |
| `invited_by` | uuid, FK → users.id | |
| `expires_at` | timestamptz | e.g. 7 days |
| `accepted_at` | timestamptz, nullable | |
| `created_at` | timestamptz | |

No changes needed to `organisations` or `users` — both already have every
column this needs (`organisations.plan_tier` already exists too, see §7.3).

---

## 4. New/changed API endpoints

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| POST | `/api/v1/orgs` | Firebase ID token only (no org yet) | Model A signup — creates org + first admin |
| POST | `/api/v1/platform/orgs` | Platform secret (like today's bootstrap) | Model B — creates org + pending invite for its admin |
| GET | `/api/v1/invites/:token` | None (public) | Validate token, return org name + role for the accept-invite page |
| POST | `/api/v1/invites/:token/accept` | Firebase ID token (freshly created) | Creates the `users` row, marks invite accepted |
| POST | `/api/v1/org/users/invite` | Admin | Spec'd in original PRD, never built — invite a teammate into your own org |
| GET | `/api/v1/org/users` | Admin | List org's users — also never built |
| PATCH | `/api/v1/org/users/:id/role` | Admin | Change role — spec'd, never built |
| DELETE | `/api/v1/org/users/:id` | Admin | Remove user (soft delete) — spec'd, never built |
| PATCH | `/api/v1/org` | Admin | Update org name/logo/contact email — spec'd, never built |

Edge case to design for explicitly: reject a role-change or removal that
would leave an org with zero admins (currently nothing stops this since none
of these endpoints exist yet — flagging so it's not missed when they're built).

---

## 5. Email sending — a new dependency, currently missing entirely

Searched the codebase: there is no email-sending capability anywhere (no
nodemailer/SendGrid/Postmark/Resend, no SMTP config). This blocks:

- Invite emails (§2, §3)
- Model B's "invite the new admin" step (§1)
- The PRD's own B6.1 requirement — "Daprova sends post-assessment reminder
  link to learners who completed the course but not the assessment" — also
  not built, same missing dependency.

This needs a provider decision (Resend/Postmark/SendGrid are the common
lightweight choices) and a `RESEND_API_KEY`-shaped env var, following the
same pattern already used for other secrets in this project.

---

## 6. Frontend changes needed

- `/signup` — public page, Model A only.
- `/accept-invite/:token` — public page, used by both Model B and teammate
  invites: shows org name, lets the invitee set a password, then redirects
  into the dashboard.
- A **Team** (or **Settings**) page in admin-web — doesn't exist today
  (checked: `admin-web/src/pages/` has no settings/team page at all). Needs:
  user list with role + "invited/active" status, an "Invite" button + modal,
  role dropdown per row, a remove action, and an org profile section
  (name/logo/contact email) wired to the new `PATCH /api/v1/org`.
- A "Forgot password?" link on `LoginPage.tsx` — Firebase Auth has this
  built in (`sendPasswordResetEmail`), it's just never been wired up. Small,
  unrelated to the rest of this doc, but noticed during the audit.
- Model B's internal creation screen — recommend this live *outside*
  admin-web entirely (a separate small internal tool, or just a script), so
  the platform secret never ships in the customer-facing bundle.

---

## 7. Other gaps found during this audit (not just onboarding)

Compiled while reading the PRD against the current codebase — grouped by
how close to "onboarding" they are, most relevant first.

### 7.1 Directly blocks onboarding-adjacent workflows
- No report preview before download (PRD US-16 explicitly requires one —
  "Admin sees a preview before downloading"). Currently the admin generates
  blind and only sees the result via download.
- Teachable webhook (`POST /api/v1/webhooks/teachable`) exists as a stub —
  never tested against a real Teachable account/course.

### 7.2 Team & access management (covered above, listed here for completeness)
- No invite flow, no team list, no role change, no user removal, no org
  profile editing — all spec'd in the original PRD's B3.3, none built.
- No "last admin" protection once these exist (§4).
- No forgot-password link in the UI.

### 7.3 Billing / plans
- `organisations.plan_tier` exists as a column (defaults to `'starter'`) but
  is read nowhere and enforced nowhere — no feature gating, no seat limits,
  no billing integration of any kind. If pricing tiers matter for
  onboarding new orgs, this is currently pure schema, no behavior.

### 7.4 Multi-org / platform administration
- No internal "list all organisations" or "impersonate/support login" view
  for the Daprova team to debug a customer's account — everything so far
  has been tested as the one seeded org.
- No audit log of who invited whom, changed a role, or removed a user —
  worth having once §2–§4 exist, since these are exactly the actions a
  support conversation ("why can't I log in anymore") would need to trace.

### 7.5 Out of scope, not a gap — just noting for completeness
- Modules 5 (Learner Satisfaction Survey) and 6 (Tracer Survey) are V3 in
  the PRD and were never in scope for this build — not related to
  onboarding, not a regression, just not built yet.

---

## 8. Open decisions (business, not engineering)

These need an answer before implementation starts — flagging rather than
guessing:

1. Self-serve (Model A), Daprova-provisioned (Model B), or both from day one?
2. If self-serve: any review/approval gate before a new org gets full access,
   or fully automatic?
3. Email provider choice (Resend/Postmark/SendGrid/other) — affects the new
   env var and a small amount of vendor-specific code.
4. Is one-person-one-org-ever (global email/auth_uid uniqueness) acceptable,
   or does someone need to belong to two orgs at once eventually?
