# Deploying Daprova on Cloudflare (+ Neon)

Everything runs on Cloudflare except Postgres:

| Piece | Where | Deploys on push to `main` via |
|---|---|---|
| Database | **Neon** (Postgres), reached through **Cloudflare Hyperdrive** | — |
| API (`api/`) | **Cloudflare Worker** `daprova-api` | Workers Builds (Git) |
| `admin-web`, `assessment-web`, `platform-web` | **Cloudflare Pages**, one project each | Pages (Git) |

## How the API runs on Workers

- The same Express app (`api/src/app.ts`) serves both runtimes.
  `api/src/index.ts` is the Node entry (local dev); `api/src/worker.ts` is the
  Workers entry, using `nodejs_compat` + `cloudflare:node`'s
  `handleAsNodeRequest`.
- **Database:** Workers can't share a socket between requests, so each request
  gets its own small pool (`withRequestDb` in `api/src/db/index.ts`) against
  Hyperdrive, which keeps the real Neon connections warm.
- **Migrations** don't run on boot any more. `npm run deploy --workspace=api`
  runs them against `DATABASE_URL` first, then publishes the Worker.
- **Payment reconciliation** runs every minute as a Cron Trigger instead of a
  `setInterval`.
- **PDF reports:** pdfkit's built-in font files are bundled into the Worker
  (`api/src/worker/fsShim.ts`).
- **Rate limits** are counted per Worker isolate, so they're approximate rather
  than global.

> **Plan:** Workers Free allows 10 ms of CPU per request. Ordinary API calls
> fit, but generating PDF/DOCX reports probably won't. Use **Workers Paid**
> ($5/month, 30 s CPU by default) for production.

---

## Step 1 — Neon database

1. Create a project at https://neon.tech (free). Pick the region closest to
   your users.
2. From **Connection Details**, copy the **direct** connection string (host
   *without* `-pooler`; Hyperdrive does its own pooling) with
   `?sslmode=require`.

If you have old data (e.g. from Railway), `pg_dump` it and restore it into Neon
now.

## Step 2 — Hyperdrive

Cloudflare dashboard → **Storage & Databases → Hyperdrive → Create** (name
`daprova-db`, paste the Neon direct string). Or from `api/`:

```bash
npx wrangler hyperdrive create daprova-db --connection-string="postgresql://..."
```

Copy the ID and replace `REPLACE_WITH_HYPERDRIVE_ID` in `api/wrangler.jsonc`,
then commit and push.

## Step 3 — API Worker (Git-connected)

Dashboard → **Workers & Pages → Create → Workers → Import a repository** →
pick this repo, then:

- **Project name:** `daprova-api` (must match `name` in `wrangler.jsonc`)
- **Root directory:** leave blank (the repo root, so the workspace install works)
- **Build command:** leave blank
- **Deploy command:** `npm run deploy --workspace=api`
- **Build variables:** `DATABASE_URL` = the Neon direct string (encrypted).
  This is only used to run migrations during the deploy.

After the first deploy, open the Worker → **Settings → Variables and Secrets**
and add these as **Secrets**:

| Secret | Value |
|---|---|
| `SESSION_JWT_SECRET` | a long random string (`openssl rand -hex 32`) |
| `REFRESH_JWT_SECRET` | a different long random string |
| `FIREBASE_API_KEY` | Firebase Web API key |
| `RESEND_API_KEY` | Resend key (teammate invite emails) |
| `BOOTSTRAP_SECRET` | random string, only for provisioning the first org |

The plain settings (`FIREBASE_PROJECT_ID`, the three `*_ORIGIN`s,
`COOKIE_SAMESITE`, …) live in `vars` in `api/wrangler.jsonc`. Edit them there,
not in the dashboard, because every deploy overwrites dashboard values.

The API URL will be `https://daprova-api.<your-subdomain>.workers.dev`. Check
`GET /health`.

## Step 4 — Frontends on Cloudflare Pages

Create **three Pages projects** (Workers & Pages → Create → Pages → Connect to
Git), all on this repo, with **Root directory** blank:

| Project name | Build command | Output directory | Build env vars |
|---|---|---|---|
| `daprova-admin` | `npm run build --workspace=admin-web` | `admin-web/dist` | `VITE_API_BASE`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, `VITE_ASSESSMENT_WEB_ORIGIN` |
| `daprova-assess` | `npm run build --workspace=assessment-web` | `assessment-web/dist` | `API_BASE_URL` |
| `daprova-platform` | `npm run build --workspace=platform-web` | `platform-web/dist` | `API_BASE_URL`, `ADMIN_WEB_ORIGIN`, `FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID` |

- `VITE_API_BASE` / `API_BASE_URL` = the Worker URL from Step 3 (no trailing
  slash). `VITE_ASSESSMENT_WEB_ORIGIN` = `https://daprova-assess.pages.dev`.
  `ADMIN_WEB_ORIGIN` = `https://daprova-admin.pages.dev`.
- Also set `NODE_VERSION=20` on each project.
- These are baked in **at build time**. After changing one, retry the
  deployment. Builds fail on purpose if any listed var is missing.
- If Cloudflare gives a project a different `*.pages.dev` name (e.g. because
  the name is taken), update the matching `*_ORIGIN` in `api/wrangler.jsonc`
  and push, or the API will CORS-block it.

## Step 5 — Finish wiring

1. **Firebase:** Console → Authentication → Settings → **Authorized domains**:
   add the `daprova-admin` and `daprova-platform` `pages.dev` domains, or
   login fails silently.
2. **First org** (empty DB only): `POST /api/v1/bootstrap` with
   `BOOTSTRAP_SECRET` (see `api/src/routes/bootstrap.ts`). It turns itself off
   once any org exists.

## Cookies and custom domains

`*.pages.dev` and `*.workers.dev` count as different sites, so the refresh
cookie has to be `SameSite=None` (`COOKIE_SAMESITE=none`, already set).
Safari blocks such third-party cookies anyway, so there a page reload logs the
user out. The proper fix is one domain for everything, e.g.
`app.daprova.com`, `learn.daprova.com`, `api.daprova.com` (Pages → Custom
domains; Worker → Settings → Domains & Routes). Then set
`COOKIE_SAMESITE=lax` and update the `*_ORIGIN` vars.

Only production Pages URLs are allowed through CORS. Preview deployments
(`<hash>.<project>.pages.dev`) will be blocked.

## Local development

Unchanged: `npm run dev:api` runs the API on Node. To run it inside the real
Workers runtime against your local Postgres:

```bash
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgres://..." npm run dev:worker --workspace=api
```

`npm run check:worker --workspace=api` bundles the Worker without deploying
(CI runs this).
