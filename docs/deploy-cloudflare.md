# Deploying Daprova: GitHub → Cloudflare (+ Neon)

A click-by-click runbook. Follow the parts in order, because later parts need
values from earlier ones. Keep a scratch note open and fill in this table as
you go:

| Value | Where it comes from | Your value |
|---|---|---|
| Neon unpooled URL | `DATABASE_URL_UNPOOLED` in `.env.local` | |
| Hyperdrive ID | Part 2 | |
| API URL | Part 3, e.g. `https://daprova-api.<subdomain>.workers.dev` | |
| Admin URL | Part 5, e.g. `https://daprova-admin.pages.dev` | |
| Assessment URL | Part 5, e.g. `https://daprova-assess.pages.dev` | |
| Platform URL | Part 5, e.g. `https://daprova-platform.pages.dev` | |

**What goes where**

| Piece | Hosted on | Redeploys automatically on push to `main` |
|---|---|---|
| Postgres + object storage | Neon project `empty-tree-79951483`, branch `production` | — |
| DB connection pooling | Cloudflare Hyperdrive | — |
| API (`api/`) | Cloudflare Worker `daprova-api` | ✅ Workers Builds |
| `admin-web`, `assessment-web`, `platform-web` | 3 Cloudflare Pages projects | ✅ Pages |

> **Plan:** use **Workers Paid** ($5/month). The Free plan allows 10 ms of CPU
> per request, and generating PDF/DOCX reports will likely exceed it.
> Dashboard → **Workers & Pages → Plans**.

---

## Part 1 — Before you start

1. **GitHub access.** The repo is `onyewuchiscepter-sudo/Daprova`. Cloudflare
   installs its GitHub app on the account that **owns** the repo, so sign in
   to GitHub as `onyewuchiscepter-sudo` in the browser you'll use for
   Cloudflare. As a collaborator, `ScepterCode` can't grant this.
2. **Cloudflare account.** Sign up or sign in at https://dash.cloudflare.com.
3. **Neon.** This folder is already linked. Open `.env.local` and copy the
   value of `DATABASE_URL_UNPOOLED` (host without `-pooler`) into your scratch
   note. The database is empty; Part 3 creates the tables.
4. **Secrets.** Generate three random strings. Run this three times and keep
   each output:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   These become `SESSION_JWT_SECRET`, `REFRESH_JWT_SECRET` and
   `BOOTSTRAP_SECRET`.

---

## Part 2 — Hyperdrive (connects the Worker to Neon)

1. Cloudflare dashboard → **Storage & Databases → Hyperdrive → Create
   configuration**.
2. **Name:** `daprova-db`.
3. Choose to connect with a **connection string**, and paste the Neon
   **unpooled** URL. Leave caching on.
4. Click **Create**, then copy the **ID** shown on the config's page.
5. In the repo, open `api/wrangler.jsonc` and replace
   `REPLACE_WITH_HYPERDRIVE_ID` with that ID. Then:

   ```bash
   git commit -am "Set Hyperdrive ID" && git push origin main
   ```

   The API must not be imported (Part 3) before this is on `main`, or its
   first build fails.

---

## Part 3 — API Worker, connected to GitHub

1. Dashboard → **Workers & Pages → Create application → Import a
   repository** (under the Workers tab).
2. **Connect GitHub.** In the GitHub popup, install the Cloudflare app on
   `onyewuchiscepter-sudo`, choose **Only select repositories → Daprova**,
   then **Install & Authorize**.
3. Select the **Daprova** repo and fill in:

   | Field | Value |
   |---|---|
   | Project name | `daprova-api` (must match `name` in `api/wrangler.jsonc`) |
   | Production branch | `main` |
   | Build command | *(leave empty)* |
   | Deploy command | `npm run deploy --workspace=api` |
   | Non-production branch deploy command | `cd api && npx wrangler versions upload` |
   | Path / root directory (Advanced) | *(leave empty: repo root)* |

4. Under **Build variables** (Advanced), add `DATABASE_URL` = the Neon
   **unpooled** URL, and tick **Encrypt**. The deploy command uses it to run
   the database migrations before publishing.
5. Click **Deploy**. In the build log you should see `[migrate] Success: 0001_init`
   … `0016_…`, then `Deployed daprova-api`. If Cloudflare asks you to pick a
   `workers.dev` subdomain, choose one.
6. **Add secrets.** Open the Worker → **Settings → Variables and Secrets →
   Add**. For each row below, set **Type: Secret**, then **Deploy**:

   | Name | Value |
   |---|---|
   | `SESSION_JWT_SECRET` | random string #1 |
   | `REFRESH_JWT_SECRET` | random string #2 |
   | `BOOTSTRAP_SECRET` | random string #3 |
   | `FIREBASE_API_KEY` | `FIREBASE_API_KEY` from `.env.local` |
   | `RESEND_API_KEY` | `RESEND_API_KEY` from `.env.local` |

   Only add **secrets** in the dashboard. Plain settings (`FIREBASE_PROJECT_ID`,
   the `*_ORIGIN`s, `COOKIE_SAMESITE`) live in `vars` in
   `api/wrangler.jsonc`, and every deploy overwrites dashboard copies of them.
7. **Check it's up.** Open the Worker's URL (shown on its overview page) with
   `/health` on the end. You should see `{"status":"ok",...}`. Put the URL in
   your note.

---

## Part 4 — Point the API at the frontend URLs

`api/wrangler.jsonc` expects these Pages project names:

```jsonc
"ADMIN_DASHBOARD_ORIGIN": "https://daprova-admin.pages.dev",
"ASSESSMENT_WEB_ORIGIN": "https://daprova-assess.pages.dev",
"PLATFORM_WEB_ORIGIN": "https://daprova-platform.pages.dev"
```

Use exactly those names in Part 5. If Cloudflare says one is taken and gives
you a different `*.pages.dev` address, edit the matching line here and push,
or the API will block that frontend (CORS).

---

## Part 5 — Three Pages projects, connected to GitHub

Repeat for each row: dashboard → **Workers & Pages → Create application →
Pages tab → Import an existing Git repository** → **Daprova** → **Begin
setup**.

Common settings for all three:
- **Production branch:** `main`
- **Framework preset:** None
- **Root directory (Advanced):** *(leave empty)*
- **Environment variables:** add `NODE_VERSION` = `20`, plus the ones below

**a) `daprova-admin`**

| Build command | Build output directory |
|---|---|
| `npm run build --workspace=admin-web` | `admin-web/dist` |

| Variable | Value |
|---|---|
| `VITE_API_BASE` | API URL from Part 3 (no trailing `/`) |
| `VITE_FIREBASE_API_KEY` | `FIREBASE_API_KEY` from `.env.local` |
| `VITE_FIREBASE_PROJECT_ID` | `daprova-a5edb` |
| `VITE_ASSESSMENT_WEB_ORIGIN` | `https://daprova-assess.pages.dev` |

**b) `daprova-assess`**

| Build command | Build output directory |
|---|---|
| `npm run build --workspace=assessment-web` | `assessment-web/dist` |

| Variable | Value |
|---|---|
| `API_BASE_URL` | API URL from Part 3 |

**c) `daprova-platform`**

| Build command | Build output directory |
|---|---|
| `npm run build --workspace=platform-web` | `platform-web/dist` |

| Variable | Value |
|---|---|
| `API_BASE_URL` | API URL from Part 3 |
| `ADMIN_WEB_ORIGIN` | `https://daprova-admin.pages.dev` |
| `FIREBASE_API_KEY` | `FIREBASE_API_KEY` from `.env.local` |
| `FIREBASE_PROJECT_ID` | `daprova-a5edb` |

Click **Save and Deploy**. A build that stops with `… must be set in the
Cloudflare Pages build environment` is missing a variable. Add it under
**Settings → Variables and Secrets**, then **Deployments → Retry deployment**.
Variables are baked in at build time, so any change needs a redeploy.

---

## Part 6 — Firebase

Firebase Console → project **daprova-a5edb** → **Authentication → Settings →
Authorized domains → Add domain**. Add:

- `daprova-admin.pages.dev`
- `daprova-platform.pages.dev`

Without this, login fails silently.

---

## Part 7 — Create the first org and admin (empty database only)

1. Firebase Console → **Authentication → Users → Add user**. Enter the
   admin's email and a password, then copy the new user's **User UID**.
2. In **Git Bash** (PowerShell mangles the quotes), with your values filled
   in:

   ```bash
   API=https://daprova-api.<subdomain>.workers.dev
   SECRET=<BOOTSTRAP_SECRET>

   # Competency framework templates (safe to re-run)
   curl -X POST "$API/api/v1/bootstrap/templates" -H "Authorization: Bearer $SECRET"

   # First organisation + its admin (works once, while no org exists)
   curl -X POST "$API/api/v1/bootstrap" -H "Authorization: Bearer $SECRET" \
     -H "Content-Type: application/json" \
     -d '{"org_name":"Daprova","org_slug":"daprova","contact_email":"you@example.com","admin_email":"you@example.com","admin_display_name":"Your Name","admin_auth_uid":"<Firebase User UID>"}'

   # Optional: give that person access to platform-web
   curl -X POST "$API/api/v1/bootstrap/platform-admin" -H "Authorization: Bearer $SECRET" \
     -H "Content-Type: application/json" \
     -d '{"person_email":"you@example.com","platform_role":"owner"}'
   ```

3. Sign in at `https://daprova-admin.pages.dev` with that email and password.

---

## Part 8 — Smoke test

- [ ] `<API URL>/health` returns `status: ok`
- [ ] Admin sign-in works, and reloading the page keeps you signed in
      (Chrome/Edge; see the Safari note below)
- [ ] Create a cohort and copy its assessment link. It opens on
      `daprova-assess.pages.dev/assess/<token>` and submits.
- [ ] Generate a report and download both PDF and DOCX
- [ ] Worker → **Logs** shows requests with no errors

## Day to day

- **Deploying:** push to `main`. The Worker runs migrations, then publishes;
  each Pages project rebuilds itself. Pushes to other branches build previews
  only. Preview frontends can't call the production API (CORS), which is
  expected.
- **Rolling back:** Worker → **Deployments** → pick an earlier version →
  **Deploy**. Pages → **Deployments** → **Rollback**. Migrations are not
  rolled back.
- **Logs:** Worker → **Logs**, or `cd api && npx wrangler tail`.
- **Scheduled job:** payment reconciliation runs every minute (Worker →
  **Settings → Trigger Events**).

## Known limits

- **Safari logs users out on reload.** `*.pages.dev` and `*.workers.dev` are
  different sites, so the refresh cookie is a third-party cookie, and Safari
  blocks those. The fix is one custom domain for everything
  (`app.daprova.com`, `learn.daprova.com`, `api.daprova.com`): add them under
  Pages → Custom domains and Worker → Settings → Domains & Routes, then set
  `COOKIE_SAMESITE` to `lax` and update the `*_ORIGIN` vars in
  `api/wrangler.jsonc`.
- **Rate limits** are counted per Worker instance, so they're approximate.
- **The `deaprova-media` bucket** in `neon.ts` isn't used by the app yet.

## Local development

Unchanged: `npm run dev:api` runs the API on Node. To run it inside the real
Workers runtime against local Postgres:

```bash
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgres://..." npm run dev:worker --workspace=api
```

`npm run check:worker --workspace=api` bundles the Worker without deploying
(CI runs this too).
