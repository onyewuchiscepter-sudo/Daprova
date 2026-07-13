# Daprova — Organisation Onboarding, Team Management & Pricing Spec

Status: Decisions finalized 2026-07-13 — ready for implementation planning
Merges: the original onboarding-spec draft + `daprova-pricing-spec - for merge.docx`
Companion to: `Daprova_PRD_Technical_Specification.docx`

## 0. Why this document exists

The original PRD (A2.1, A3.4, B3.3) assumes an organisation already exists
and only specifies how to *invite a user into* one. It never specifies how
an organisation itself gets created, how it gets billed, or how Daprova's
own team manages/supports the organisations running on the platform. Those
gaps were worked around during deployment with a one-time, secret-gated
`/api/v1/bootstrap` endpoint — fine for the first customer, not a real
system. This document replaces that with a designed onboarding, billing, and
platform-administration system, with every open decision resolved through a
Q&A pass with the founder (recorded inline below so the reasoning isn't lost).

---

## 1. Onboarding models — CONFIRMED: both

Both models end at the same place — a row identifying the org and a row
identifying its first admin — they differ only in *who* triggers creation
and *how the admin's login gets set up*.

### Model A — Self-serve signup

Public `/signup` page, no auth required. Uses the exact field set from the
registration form draft:

**Section 1 — the organisation**
- Organisation name
- Organisation type (dropdown: EdTech / Training academy / NGO / Bootcamp / School / Other)
- CAC registration number (optional — flagged for verification later if they
  request custom invoicing or reach Enterprise tier; not required at signup)
- Website or social media link (optional)
- Physical address / state

**Section 2 — the admin account**
- Full name
- Role/title (e.g. Program Manager, Founder, M&E Lead)
- Email address (becomes their login)
- Phone number (for WhatsApp/SMS support)

**Section 3 — intended usage**
- Primary use case (dropdown: Skills training outcomes / Admissions or
  placement testing / Certification / Donor or funder reporting / Other)
- **Expected number of students in your first cohort** — this is not just a
  survey field, it's a required input to the pricing engine (§5): it
  determines free-trial eligibility and initial tier assignment. Must be
  collected before org creation completes, not after.
- Expected cadence (One-off / Quarterly / Continuous-rolling)

**Section 4 — context**
- Reporting to a funder/board/accreditation body? (Yes/No, optional "which one")
- How did you hear about Daprova? (dropdown: referral, social media, event,
  existing Daprova client, other)

**Flow:**
1. Submit the form. Client-side, create the Firebase user
   (`createUserWithEmailAndPassword` — same SDK call `LoginPage.tsx` already
   uses, just for signup).
2. Client calls `POST /api/v1/orgs` with the Firebase ID token + all form data.
3. Server verifies the ID token (existing `firebaseAuth.verifyIdToken`, no
   new dependency), runs the fraud-signal check (§7.2) and the tier/free-trial
   assignment (§5.3) against "expected student count," then creates the org
   + admin `org_membership` (§2) in one transaction, and issues a Daprova
   session the same way `/auth/verify` does today.
4. If the fraud check flags a possible match: org is still created (no hard
   block, per the founder's confirmed approach), but marked
   `signup_review_status = 'flagged'` for manual review (§7.2) rather than
   silently approved.
5. If expected student count is 1,000+: skip tier/payment entirely, create
   the org in `pending_manual_quote` status, and route to a "Contact Sales"
   screen instead of the dashboard (§5.5).
6. Otherwise: admin lands straight in the dashboard, framework-template
   picker included.

### Model B — Team-provisioned (confirmed, credentials handed out directly)

Confirmed mechanic: your team sets a password directly and delivers it to
the customer yourselves (phone/email/WhatsApp) — **not** an automated
invite-email link. This is simpler than originally drafted: this specific
path has no email-sending dependency at all.

1. A Daprova team member — someone with the new **platform-admin** role
   (§7.1) — uses the internal platform tool (§7.5) to enter org details +
   admin name/email, and sets an initial password.
2. Server creates the `organisations` row and the admin's `people` +
   `org_membership` rows (§2) directly, active immediately — no invite
   token, no pending state.
3. Team member communicates the login + password to the customer outside
   the system.

This generalizes today's one-time `/api/v1/bootstrap` into a repeatable,
audited action (logged to `audit_log`, §7.4). It's also the natural home
for **Enterprise deals**: when a signup (or an existing org's growth)
crosses the 1,000-student threshold, that's routed to a sales conversation,
and the actual account activation happens through this same Model B
mechanism once terms are agreed — Enterprise isn't a third model, it's
Model B triggered by a sales process instead of a self-serve click.

---

## 2. Multi-org membership — CONFIRMED: yes (data model change required)

Confirmed: a single person (one email, one Firebase login) must be able to
belong to more than one organisation — e.g. a consultant working with two
different EdTechs. This is a real structural change, not a flag:

**Current design** (`users` table): one row = one org membership, with
`email` and `auth_uid` globally unique — identity and org-membership are the
same row, which is exactly what makes multi-org impossible.

**New design** — split identity from membership:

- **`people`** — one row per human, globally unique on `auth_uid` and
  `email`. Holds `display_name`, `created_at`, `last_login_at`.
- **`org_memberships`** — one row per (person, org) pair: `person_id` (FK →
  people), `org_id` (FK → organisations), `role` (`admin`/`viewer`),
  `created_at`, `deleted_at` (soft-remove from one org without touching the
  person's other memberships or their login).

**Login flow change:**
1. Verify Firebase ID token → resolve to a `people` row (as today).
2. Look up all active `org_memberships` for that person.
3. Exactly one → issue a session scoped to that org automatically (no
   visible change from today's UX for the common single-org case).
4. More than one → show an org picker before entering the dashboard.

**New UI affordance:** a "switch organisation" control (e.g. next to the org
name in the admin-web header) that re-issues a session scoped to a
different org the same person belongs to, without re-authenticating with
Firebase.

Note: platform-admin status (§7.1) is modeled separately from
`org_memberships` — a Daprova staff member's platform role is independent
of whether they personally belong to any customer org.

Every other section below (invites, team management, API list-users) is
written in terms of `org_memberships`, not `users`, to stay consistent with
this.

---

## 3. Inviting a teammate into an existing org

Spec'd in the original PRD (`POST /api/v1/org/users/invite`), never built.
Unlike Model B, this flow *does* need email — the invitee isn't someone your
team is handing a password to directly.

1. Admin, from the new Team/Settings page (§6), enters an email + role.
2. Server creates an `invites` row (§4), sends an invite email via **Resend**
   (confirmed provider, §8).
3. Invitee clicks the link, sets a password (creates their `people` row if
   they don't already have one from another org — see §2), and the
   invite-accept endpoint creates the `org_membership` row against the
   `org_id` from the invite.

---

## 4. Data model changes

### 4.1 New: `invites`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `org_id` | uuid, FK → organisations.id | |
| `email` | varchar(255) | invitee's email |
| `role` | varchar(50), check `admin`/`viewer` | |
| `token` | varchar(255), unique | random, single-use |
| `invited_by` | uuid, FK → people.id | |
| `expires_at` | timestamptz | e.g. 7 days |
| `accepted_at` | timestamptz, nullable | |
| `created_at` | timestamptz | |

### 4.2 Restructured: `users` → `people` + `org_memberships`

Replaces the current flat `users` table (§2 has the full rationale). Existing
seeded users migrate as: one `people` row + one `org_memberships` row each.

### 4.3 Extended: `organisations`

New columns needed for pricing/billing (from the pricing spec's data model,
§1) on top of the existing `plan_tier`/`logo_url`/`contact_email` etc.:

| Column | Type | Notes |
|---|---|---|
| `has_used_free_trial` | boolean, default false | set true the moment cohort #1 is created, regardless of outcome |
| `current_plan_tier` | varchar(50) | current tier key, replaces the unused `plan_tier` default |
| `billing_status` | varchar(50) | e.g. `active` / `locked_pending_upgrade` / `pending_manual_quote` / **`suspended`** (§7.2) |
| `signup_review_status` | varchar(50), nullable | `flagged` if the fraud check (§7.2) matched an existing org, else null |

### 4.4 Extended: `cohorts`

| Column | Type | Notes |
|---|---|---|
| `cohort_number` | int | ordinal per org — 1st cohort ever, 2nd, etc. |
| `student_count` | int | live count, drives tier enforcement |
| `is_free_trial` | boolean | set once at creation, per §5.4's rule |
| `plan_tier_at_creation` | varchar(50) | locks in the tier a cohort was priced at |
| `status` | enum, extended | existing values plus `locked_pending_upgrade`, `pending_manual_quote` |

### 4.5 New: `plan_tiers` (reference/config table)

| Column | Type |
|---|---|
| `tier_id` | varchar(50), PK |
| `name` | varchar(100) |
| `min_students` | int |
| `max_students` | int, nullable (null = uncapped, i.e. Enterprise) |
| `price` | numeric |
| `features` | jsonb (array of feature keys) |

Seeded once with the confirmed tiers (§5.1) — not hardcoded in application
code, per the pricing spec's own instruction ("implement as a `features[]`
array checked at render/API level, don't hardcode tier checks scattered
through the codebase").

### 4.6 New: `payments`

| Column | Type |
|---|---|
| `id` | uuid, PK |
| `org_id` | uuid, FK |
| `cohort_id` | uuid, FK |
| `amount` | numeric |
| `status` | varchar(50) |
| `provider` | varchar(50) — `paystack` / `flutterwave` |
| `paid_at` | timestamptz, nullable |

### 4.7 New: `cohort_tier_history`

Audit trail of every tier change on a cohort (upgrades, re-tiers) —
`cohort_id`, `old_tier`, `new_tier`, `changed_at`, `payment_id`.

### 4.8 New: `signup_fraud_flags`

Supports the fraud-review queue (§7.2) — a real queue, not just a log line:

| Column | Type |
|---|---|
| `id` | uuid, PK |
| `org_id` | uuid, FK — the new signup |
| `matched_org_id` | uuid, FK — the existing org it resembles |
| `match_reason` | varchar(100) — e.g. `phone_match`, `domain_match`, `name_similarity` |
| `reviewed_at` | timestamptz, nullable |
| `reviewed_by` | uuid, FK → people.id, nullable |
| `decision` | varchar(50), nullable — e.g. `approved` / `rejected` |
| `created_at` | timestamptz | |

### 4.9 New: `platform_admins`

Backs the platform-admin role model (§7.1) — deliberately separate from
`org_memberships`, since platform staff aren't scoped to any one org:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `person_id` | uuid, FK → people.id, unique | |
| `platform_role` | varchar(50), check `support`/`owner` | see §7.1 |
| `granted_at` | timestamptz | |
| `granted_by` | uuid, FK → people.id, nullable | who gave them platform access |

### 4.10 New: `impersonation_sessions`

Backs impersonation (§7.3):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `platform_admin_person_id` | uuid, FK → people.id | who's impersonating |
| `target_org_membership_id` | uuid, FK → org_memberships.id | whose view they're seeing |
| `reason` | text, not null | required free-text justification |
| `mode` | varchar(20), check `write`/`read_only` | derived from the admin's `platform_role` at session start (§7.3) — `owner` → `write`, `support` → `read_only` |
| `started_at` | timestamptz | |
| `expires_at` | timestamptz | hard TTL, e.g. `started_at` + 30 min |
| `ended_at` | timestamptz, nullable | set on explicit early end |

### 4.11 New: `audit_log`

General-purpose log covering both ordinary org-admin actions (role changes,
invites, removals) and platform-admin actions (impersonation, org
suspension, tier overrides) — one table instead of two separate logging
systems:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `actor_person_id` | uuid, FK → people.id, nullable | null if system-triggered |
| `actor_context` | varchar(50) | `org_admin` / `platform_admin` / `impersonating` |
| `org_id` | uuid, FK → organisations.id | the org affected |
| `action` | varchar(100) | e.g. `invite_created`, `role_changed`, `org_suspended`, `tier_overridden`, `impersonation_started` |
| `details` | jsonb | free-form context (old/new role, old/new tier, etc.) |
| `created_at` | timestamptz | |

---

## 5. Pricing — CONFIRMED: fixed tiers

### 5.1 Why fixed tiers over the per-block formula

Confirmed decision, reasoning worth keeping: features (exportable reports,
custom branding, advanced analytics, API access, priority support) are
inherently discrete — an org either qualifies for a feature tier or it
doesn't, there's no fractional version of "advanced analytics" at 80
students. A per-block price formula wouldn't remove the need for a tier
table (features would still need one), it would only add pricing complexity
on top of it. Fixed tiers are strictly less total complexity, easier to
test at the boundaries, and produce clean, sellable invoice amounts.

### 5.2 Confirmed tier table

| Tier | Student range | Price (₦/cycle) | Notes |
|---|---|---|---|
| FREE_TRIAL | 1–50 | ₦0 | Only if `org.has_used_free_trial == false` AND `cohort_number == 1` |
| ENTRY | 1–50 | ₦20,000 | Default from 2nd cohort onward |
| GROWTH | 51–100 | **₦45,000** | Confirmed exact price (was a ₦40k–50k range) |
| SCALE_1 | 101–250 | **₦100,000** | Confirmed exact price (was ₦80k–120k); + exportable reports, custom branding |
| SCALE_2 | 251–1,000 | **₦250,000** | Confirmed exact price (was ₦200k–300k); + advanced analytics, API access, priority support |
| ENTERPRISE | 1,000+ | Custom quote | No self-serve checkout — routes to Model B's sales path (§1) |

Prices are round midpoints of the original ranges, chosen as a starting
point and explicitly revisitable later.

### 5.3 Feature flags by tier

Unchanged from the pricing spec — implemented as `plan_tiers.features[]`
(§4.5), checked at render/API level:

| Feature | FREE_TRIAL | ENTRY | GROWTH | SCALE_1 | SCALE_2 | ENTERPRISE |
|---|---|---|---|---|---|---|
| Auto-scoring | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Basic pre/post comparison | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Exportable/downloadable reports | — | — | ✓ | ✓ | ✓ | ✓ |
| Custom branding/white-label | — | — | ✓ | ✓ | ✓ | ✓ |
| Advanced cohort-level analytics | — | — | — | ✓ | ✓ | ✓ |
| API/LMS integration | — | — | — | — | ✓ | ✓ |
| Priority support | — | — | — | — | ✓ | ✓ |
| Offline/self-hosted deployment | — | — | — | — | — | ✓ |

### 5.4 Enforcement logic (unchanged from the pricing spec's pseudocode)

- **Free-trial eligibility**: `org.has_used_free_trial == false`, checked
  once at first-cohort creation. The instant that cohort is created,
  `has_used_free_trial` flips to true — regardless of whether it ever
  reaches 50 students (prevents "saving" the free trial with a tiny cohort).
- **Student cap**: block + prompt upgrade at `student_count >= tier.max`;
  warn at 90% of cap (e.g. banner at 45/50).
- **Mid-cohort upgrade**: never lock out already-enrolled students' data.
  On payment confirmation, re-tier the *entire* cohort (not just the
  overage) — billing is on final total size, not split by when students
  joined.
- **New cohort (2nd onward)**: no free tier ever again once
  `has_used_free_trial == true`, regardless of size.

### 5.5 Enterprise routing

At 1,000+ projected students (signup or growth), skip self-serve checkout
entirely — `status = pending_manual_quote`, routed to a "Contact Sales"
screen, activated later through Model B (§1) once terms are agreed.

### 5.6 Payment flow

1. Cohort reaches a tier requiring payment (new paid cohort or mid-cohort
   upgrade).
2. Generate invoice via Paystack or Flutterwave (NGN-denominated).
3. Webhook confirms payment → `cohort.status = active`,
   `payment.status = confirmed`, tier's `features[]` unlocked.
4. Failed/pending payment → cohort stays `locked_pending_upgrade`; existing
   data stays visible/read-only, no new students or attempts until cleared.
5. Every tier change logged to `cohort_tier_history` (§4.7).
6. **Reconciliation job**: poll payment provider status for pending
   payments on an interval — don't rely solely on webhook delivery.

### 5.7 Other confirmed edge-case behavior (unchanged from pricing spec)

- Cohort starts at 45 (free trial), grows to 60 → blocked at 50, must
  upgrade; free trial doesn't extend to cover overage.
- Org pays for ENTRY but only enrolls 10 → flat price, no proration.
- Two simultaneous cohorts → priced/tiered independently by their own
  `cohort_number`/size; free trial only applies to whichever is genuinely
  the org's first ever.

### 5.8 Deferred — CONFIRMED

Annual/quarterly commitment discounts (pay further ahead, pay less per
cycle) are explicitly **deferred** — flat per-cycle pricing for v1,
regardless of how far ahead an org commits. Revisit as a future addition;
don't design further now.

---

## 6. Frontend changes needed (customer-facing)

- `/signup` — public page, Model A, full field set from §1.
- `/accept-invite/:token` — public page, teammate-invite flow only (§3;
  Model B no longer needs this per the confirmed mechanic).
- **Organisation switcher** — new, required by §2's multi-org decision.
- A **Team/Settings** page in admin-web (still doesn't exist — checked,
  `admin-web/src/pages/` has none): member list (now sourced from
  `org_memberships`), invite button + modal, role dropdown, remove action,
  org profile section wired to `PATCH /api/v1/org`.
- A "Forgot password?" link on `LoginPage.tsx` — Firebase Auth has this
  built in (`sendPasswordResetEmail`), just never wired up.
- **Billing/upgrade UI**: current tier + usage display, 90%-capacity
  warning banner, upgrade-and-pay flow, `locked_pending_upgrade` messaging,
  Enterprise "Contact Sales" screen.

(Platform-side frontend — the internal tool your own team uses — is
covered separately in §7.5, since it's a distinct surface from the
customer-facing admin-web bundle.)

---

## 7. Platform Administration — the Daprova-side control plane

This is the piece that was missing entirely from the original merge: tools
for *your team* to run and support the platform, as distinct from anything
an org's own admin can do. Everything below is new design, not carried over
from either source document.

### 7.1 Platform-admin role model

Today's `role` (`admin`/`viewer`) lives on `org_memberships` and is entirely
org-scoped — nothing distinguishes "your team" from "a customer's own
admin." New, separate concept, backed by `platform_admins` (§4.9):

- **`support`** — day-to-day support capabilities: view any org's profile
  and usage, review/decide fraud flags (§7.2), impersonate read-only
  (§7.3), resend a stuck invite, view the audit log.
- **`owner`** — everything `support` can do, plus the higher-stakes
  actions: suspend/reactivate an org, override a tier, manually correct
  billing status, extend/grant a free-trial exception, close an org, and
  grant platform-admin status to other staff.

A person can simultaneously be a platform admin *and* a regular
`org_membership` admin/viewer of their own org (e.g. if your team also
tests against its own account) — these are orthogonal, matching §2's
identity/membership split. A new `requirePlatformRole(...)` middleware
(parallel to the existing `requireRole` for org-scoped roles) gates
everything in this section.

### 7.2 Org regulation

Concrete actions a platform admin (`owner`, except where noted) can take on
any organisation — none of these exist today:

| Action | Platform role | Effect |
|---|---|---|
| View any org's full profile, members, billing, cohorts | `support` | read-only |
| Approve/reject a flagged signup | `support` | resolves a `signup_fraud_flags` row (§4.8) |
| Suspend an org | `owner` | blocks all its `org_memberships` from logging in; data untouched |
| Reactivate a suspended org | `owner` | reverses the above |
| Override an org's plan tier | `owner` | manual correction or comping a customer, bypasses the normal tier-assignment logic |
| Manually correct billing status | `owner` | e.g. confirming an offline/bank-transfer payment for an Enterprise deal |
| Extend or grant a free-trial exception | `owner` | goodwill/manual override of §5.4's normal one-time rule |
| Close/delete an org | `owner` | soft delete (`deleted_at`), same pattern already used throughout the schema — doesn't destroy historical data |

**Fraud prevention** (confirmed: build now, not deferred) is the first
concrete instance of org regulation, so it's specified fully here:

1. At signup (Model A), normalize and compare the new org's **phone
   number**, **website/domain**, and **organisation name** (fuzzy match)
   against all existing organisations.
2. Any match → do **not** block the signup. Create the org normally, but
   set `signup_review_status = 'flagged'` and write a row to
   `signup_fraud_flags` (§4.8) recording which existing org it matched and
   why.
3. Platform admins review flagged signups from the internal queue (§7.5)
   and record a decision (`approved`/`rejected`) — rejection is a manual
   follow-up action (e.g. suspend the org via the table above), not an
   automatic lockout, consistent with "flag, don't block."

v1 scope: exact/normalized matching on phone and domain, plus simple name
similarity (e.g. lowercased/trimmed comparison or a basic string-distance
threshold) — refine the matching algorithm later if it proves too loose or
too strict in practice.

Every action in this section writes an `audit_log` (§4.11) row.

### 7.3 Impersonation — "see what happens in the org"

The sensitive one, so it gets real guardrails rather than just a "log in as
them" shortcut.

**Scope: write access is role-gated, not all-or-nothing.** CONFIRMED:
- **`owner`** (the founder) can impersonate with full write access — can
  act in the org exactly as that member could, not just view.
- **`support`** (the rest of the team) can only impersonate read-only — can
  see what the member sees, but can't create, edit, or delete anything.

This maps directly onto the two-tier role model (§7.1) rather than adding a
third axis: the permission a session gets while impersonating is simply
derived from the impersonating admin's own `platform_role` at the time.

**Mechanism:**
1. Platform admin picks a target org + specific member to view as, and
   supplies a **required reason** (free text) — no impersonation without one,
   regardless of role.
2. Server creates an `impersonation_sessions` row (§4.10) and issues a
   special token: same shape as a normal session token, but flagged
   `impersonating: true` with an `impersonation_mode` of `write` or
   `read_only` (derived from the admin's `platform_role` — `owner` → write,
   `support` → read_only), scoped to the target org/role, with a **short,
   hard expiry** (e.g. 30 minutes) — distinct from a normal session's
   24-hour lifetime.
3. Middleware checks the `impersonating` flag on every request: if
   `impersonation_mode == 'read_only'`, any write method
   (`POST`/`PATCH`/`PUT`/`DELETE`) is rejected outright, except the
   explicit "end impersonation" action itself. If `impersonation_mode ==
   'write'`, requests proceed normally — but every one of them is logged
   (see point 6), since this is the highest-trust, highest-risk path in
   the whole system.
4. The admin-web UI shows a **persistent, unmissable banner** for the
   whole session, and it must visibly differ by mode — e.g. "Viewing as
   {org name} / {member email} (read-only) — [End impersonation]" for
   `support`, versus "Acting as {org name} / {member email} — every action
   is logged — [End impersonation]" for `owner` — so there's never
   ambiguity about which context or capability level is active.
5. Ending: either the admin clicks "End impersonation" (`ended_at` set
   immediately), or the token simply expires at `expires_at` (same
   mechanism as normal session expiry — no separate sweep needed).
6. Every impersonation start/end is written to `audit_log` (§4.11) with
   `actor_context = 'impersonating'`. For `write`-mode sessions
   specifically, every individual mutating request made during the session
   should also be logged (not just start/end) — since this is the one path
   where a platform admin can directly change a customer's data, "what
   exactly did they change" needs to be reconstructable afterward, not just
   "that a session happened."

**Policy, CONFIRMED:** the ToS/privacy policy will **not** disclose that
support staff can access an org's account for support purposes. The
`audit_log` (§4.11) therefore exists purely as an internal accountability
record — not something surfaced to customers, and not something to
reference in customer-facing policy copy.

### 7.4 Audit log

Single `audit_log` table (§4.11) serves both purposes already identified as
gaps: ordinary org-admin actions (invites, role changes, removals — closes
the gap noted in the original audit) and every platform-admin action above
(suspensions, tier overrides, impersonation). One system, not two.

### 7.5 Platform-side frontend

A genuinely separate internal tool — **not** a hidden route inside the
customer-facing admin-web bundle, and no longer just "behind a shared
secret" now that there's a real per-person `platform_admins` role backing
it:

- **Org directory/search** — list/filter all organisations by status,
  tier, flagged state.
- **Org detail view** — members, billing, cohorts, and the regulation
  actions from §7.2 (suspend, reactivate, override tier, correct billing,
  extend trial, close).
- **Fraud-review queue** — the `signup_fraud_flags` list, approve/reject.
- **Impersonation launcher** — pick org + member + reason, starts a
  session per §7.3.
- **Persistent impersonation banner** while a session is active, with an
  End button, rendered wherever the platform admin is currently viewing.
- **Audit log viewer** — searchable/filterable view over `audit_log`.
- **Org creation form** — Model B's flow (§1): org + admin details, set a
  password, hand credentials to the customer directly.

### 7.6 Decisions from this section's Q&A

1. ~~Two platform-role tiers (`support`/`owner`)~~ — **CONFIRMED**: two
   tiers is fine.
2. ~~Read-only vs. write impersonation~~ — **CONFIRMED**: role-gated, not
   uniform. Only `owner` (the founder) can impersonate with write access;
   `support` (the rest of the team) is read-only-while-impersonating. See
   the updated §7.3.
3. ~~Legal/policy disclosure of support-staff account access~~ —
   **CONFIRMED**: no disclosure. See §7.3's updated policy note.

No open items remain in this section.

---

## 8. Email — CONFIRMED: Resend

Needed for the teammate-invite flow (§3) and the PRD's own unbuilt B6.1
requirement ("post-assessment reminder link to learners who completed the
course but not the assessment"). Not needed for Model B (§1) or for the
platform-admin tool (§7), since those hand out or use credentials directly
rather than emailing a link.

Chosen for the same reason this project has favored lightweight,
developer-first tooling throughout (Kysely over Prisma, `jose`/JWKS over
firebase-admin, pdfkit over Puppeteer): TypeScript-first SDK, simplest
integration, generous free tier for what will be low transactional volume.
Needs a `RESEND_API_KEY` env var, following the existing secrets pattern.

---

## 9. Other gaps found during this audit (not onboarding/billing/platform-admin)

### 9.1 Directly blocks onboarding-adjacent workflows
- No report preview before download (PRD US-16 explicitly requires one).
- Teachable webhook (`POST /api/v1/webhooks/teachable`) is an untested stub.

### 9.2 Team & access management
- No "last admin" protection — must reject a role-change or removal that
  would leave an org with zero admins, once these endpoints exist.

### 9.3 Out of scope, not a gap
- Modules 5 (Learner Satisfaction Survey) and 6 (Tracer Survey) are V3 in
  the PRD, never in scope for this build — unrelated to onboarding/billing.

(The two items previously listed here — no internal "list all orgs" view,
and no audit log — are now addressed by design in §7.)

---

## 10. Résumé — every decision from the Q&A passes (2026-07-13)

| # | Question | Decision |
|---|---|---|
| 1 | Self-serve vs. team-provisioned onboarding? | Both — self-serve signup form, and the team can create orgs directly and hand out credentials |
| 2 | Email provider? | Resend |
| 3 | One-org-per-person, or multi-org? | Multi-org — requires the `people`/`org_memberships` split |
| 4 | Fixed tiers vs. per-block pricing formula? | Fixed tiers |
| 5 | Exact ₦ prices for GROWTH/SCALE_1/SCALE_2? | ₦45,000 / ₦100,000 / ₦250,000 (round midpoints, revisitable) |
| 6 | Annual/quarterly commitment discounts? | Deferred — flat pricing for v1 |
| 7 | Free-trial fraud prevention — build now or later? | Build now — lightweight flag-for-review, not a hard block |
| 8 | One platform-admin tier, or two (`support`/`owner`)? | Two tiers |
| 9 | Impersonation: read-only for everyone, or role-gated? | Role-gated — only `owner` gets write access while impersonating; `support` stays read-only |
| 10 | Disclose support-staff account access in ToS/privacy policy? | No disclosure |

Every decision needed to move this spec from draft to implementation-ready
has now been made. What remains is intentionally deferred, not undecided:

### Deferred by choice, not forgotten
- Commitment-discount design — explicitly deferred (§5.8) for a future pass.
- The exact fraud-matching algorithm (name-similarity threshold etc.) —
  scoped as "start simple, refine later" (§7.2), not a blocker to shipping v1.

---

## 11. Implementation Roadmap

Sequenced by dependency, not by section order — the identity restructuring
in Sprint 1 is load-bearing for literally everything else in this document,
so it goes first regardless of how "small" it looks on paper. Numbered
independently from the original PRD's S1–S6 (this is new scope on top of
that MVP, not a continuation of it). Doesn't include the unrelated gaps
noted in §9 (report preview, Teachable webhook testing) — those are
separate from this initiative and can be scheduled independently.

### Sprint 1 — Identity restructuring
**Goal:** split `users` into `people` + `org_memberships` (§2, §4.2) without
breaking anything already built.
- Migration: `people`, `org_memberships`, backfill existing seeded users as
  one row each.
- Update auth middleware, session claims, and every existing route
  currently reading `req.auth.org_id`/`role` (frameworks, courses, cohorts,
  reports — the entire API surface built in S1–S11) to the new model.
- Login flow: resolve to `people`, then to active `org_memberships`; org
  picker if more than one.
- Org-switcher UI in admin-web.
- **Verification:** full regression pass on every existing feature (login,
  framework builder, assessments, dashboards, equity, reports) — this
  sprint touches the foundation everything else sits on, so nothing new
  ships without confirming nothing old broke.

### Sprint 2 — Platform-admin foundation + Model B
**Goal:** stand up the internal control plane and unblock manual
onboarding of real customers.
- `platform_admins` table, `requirePlatformRole` middleware (§7.1).
- `audit_log` table (§4.11), logging wired into org creation.
- Internal platform tool (separate surface, §7.5): org directory
  (read-only list), org detail view, org-creation form (Model B, §1) —
  team sets a password directly, hands it to the customer.
- **Verification:** create a real second org through this tool end-to-end,
  confirm its admin can log in and use the product normally.

### Sprint 3 — Team management & invites
**Goal:** the invite-a-teammate flow the original PRD spec'd but never
built (§3). Independent of pricing/platform-admin work — can run in
parallel with Sprint 2.
- `invites` table (§4.1), Resend integration (§8).
- `POST /api/v1/org/users/invite`, `GET /api/v1/invites/:token`,
  `POST /api/v1/invites/:token/accept`, `/accept-invite/:token` page.
- Team/Settings page in admin-web: member list, invite modal, role
  dropdown, remove action, **last-admin protection** (§9.2), org profile
  edit (`PATCH /api/v1/org`).
- Forgot-password link on `LoginPage.tsx` (small, unrelated, bundled here
  since it's on the same page).
- **Verification:** invite a second admin and a viewer into an existing
  org, confirm role differences enforce correctly, confirm removing the
  last admin is rejected.

### Sprint 4 — Pricing engine (schema + enforcement)
**Goal:** get tier logic correct and testable before payment integration
adds its own complexity.
- `plan_tiers` (seeded with §5.2's confirmed prices), new columns on
  `organisations`/`cohorts` (§4.3, §4.4), `cohort_tier_history` (§4.7).
- Tier assignment (`getTierForStudentCount`, `isEligibleForFreeTrial`),
  student-cap enforcement (block at max, warn at 90%), feature-flag checks
  (§5.3) wired into existing endpoints.
- No live payment collection yet — `locked_pending_upgrade` can be
  resolved manually via direct action for now (real regulation UI comes in
  Sprint 7); the point of this sprint is proving the tier math and
  enforcement rules are right in isolation.
- **Verification:** synthetic cohorts at each tier boundary (49/50/51,
  etc.), confirm free-trial-once-ever rule, confirm mid-cohort re-tiering
  doesn't lock out existing learner data.

### Sprint 5 — Self-serve signup (Model A) + fraud prevention
**Goal:** self-serve onboarding goes live.
- `/signup` page with the full field set (§1), `POST /api/v1/orgs`.
- Tier/free-trial assignment at signup using Sprint 4's engine, keyed off
  "expected number of students."
- Fraud-signal check (§7.2), `signup_fraud_flags` table (§4.8), fraud-review
  queue added to the platform tool from Sprint 2.
- Enterprise routing (§5.5): 1,000+ skips tier assignment, goes to
  `pending_manual_quote` + "Contact Sales" screen.
- **Verification:** sign up a fresh org through the real form, confirm
  correct tier/free-trial assignment, confirm a deliberately-duplicated
  phone/domain gets flagged without being blocked.

### Sprint 6 — Payments (Paystack/Flutterwave)
**Goal:** real money moves. Isolated from tier logic (already proven in
Sprint 4) so this sprint is purely about the payment integration itself.
- `payments` table (§4.6), invoice generation, webhook handling.
- **Reconciliation job** polling payment status — don't rely solely on
  webhook delivery (§5.6).
- Upgrade-and-pay UI flow, `locked_pending_upgrade` messaging.
- **Verification:** a full upgrade-triggered payment round-trip on a test
  Paystack/Flutterwave account, including a deliberately-delayed/failed
  webhook to confirm the reconciliation job catches it.

### Sprint 7 — Org regulation
**Goal:** give the platform-admin tool (Sprint 2) the higher-stakes actions
now that there's real billing state (Sprints 4/6) to act on.
- Suspend/reactivate, tier override, manual billing-status correction,
  trial extension, close org (§7.2) — all `owner`-gated, all logged to
  `audit_log`.
- **Verification:** suspend a test org, confirm its members are locked out
  without data loss; override a tier and confirm features unlock/lock
  correctly; confirm every action produced an audit-log row.

### Sprint 8 — Impersonation
**Goal:** the most sensitive capability, built last, once the role model,
audit log, and real org data are all mature.
- `impersonation_sessions` table (§4.10), short-lived scoped tokens with
  `mode` (`write`/`read_only`) derived from `platform_role` (§7.3).
- Middleware enforcement (block writes in `read_only` mode), persistent
  UI banner distinguishing the two modes, per-request logging for
  `write`-mode sessions.
- **Verification:** impersonate as `support` and confirm every write
  attempt is rejected; impersonate as `owner` and confirm writes succeed
  *and* are individually logged; confirm the session hard-expires at TTL.
- Legal/policy disclosure of support-staff account access (§7.6) — the one
  remaining item, and it's a business/legal call, not an engineering one.
