# Deploying the backend

The frontend (Vite SPA) already auto-deploys to **Vercel** on push to `master` and
runs the in-memory mock by default. To run the **real backend** in production you
deploy `server/` to an always-on host (Railway) and point the SPA at it.

> Vercel can't host the stateful WebSocket backend (serverless functions are
> short-lived), so the API lives on Railway; only the SPA stays on Vercel.

## 1 · Backend → Railway

1. Create a Railway service from this repository.
2. In the service settings, set **Root Directory = the repository root** (the
   directory that contains [`railway.toml`](railway.toml)). It must be the repo
   root — **not** `server/` — because the Docker build context needs both
   `server/` and the shared `src/` the server bundles. Railway reads
   `railway.toml`, which selects the Dockerfile builder (`server/Dockerfile`),
   the pre-deploy migration command, and the `/healthz` health check. (There is
   no `server/railway.json`.)
3. Add a **PostgreSQL** plugin → Railway injects `DATABASE_URL`.
4. Set service variables (each is read by [`server/src/env.ts`](server/src/env.ts)):
   | Variable | Value |
   |---|---|
   | `AUTH_PROVIDER` | `supabase` — verifies real Supabase JWTs (required in prod) |
   | `SUPABASE_JWT_SECRET` | Supabase → Project Settings → API → JWT Secret (**required** when `AUTH_PROVIDER=supabase`) |
   | `PUBLIC_SERVER_URL` | `https://<service>.up.railway.app` (**required in prod**; pins the device-pairing QR target) |
   | `ALLOWED_ORIGIN` | `https://phone-farm-app.vercel.app` (your exact Vercel origin, or a comma-separated list) |
   | `PROVIDER` | `simulated` (or `corellium` once wired) |
   | `DATABASE_URL` | (auto from the Postgres plugin) — runtime app role |
   | `MIGRATION_DATABASE_URL` | dedicated least-privilege migration role (pre-deploy only); see the runbook |

   (`PORT` is injected by Railway.)
5. Deploy. The **Dockerfile** build (`server/Dockerfile`) compiles the server and
   the shared `src/` into `server/dist/index.js` (and generates the Postgres
   Prisma client). The **pre-deploy** command `npm run migrate:deploy` applies
   versioned migrations (`prisma migrate deploy`) once per release — a failure
   aborts the deploy. The **start** command is server-only (`node dist/index.js`)
   and never mutates the schema. See
   [`server/ops/PRODUCTION_MIGRATION_RUNBOOK.md`](server/ops/PRODUCTION_MIGRATION_RUNBOOK.md)
   for the one-time baseline bootstrap. Note the public URL, e.g.
   `https://phone-farm-app-production.up.railway.app`.

## 2 · Frontend → Vercel

Set Production env vars (Project → Settings → Environment Variables), then redeploy
(Vite inlines `VITE_*` at build time):

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` (enables auth) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon public key (enables auth) |
| `VITE_APP_URL` | `https://phone-farm-app.vercel.app` (password-reset redirect target) |
| `VITE_USE_BACKEND` | `1` |
| `VITE_API_URL` | `https://<railway-url>` |
| `VITE_WS_URL` | `wss://<railway-url>` |

> ⚠ **Both** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` must be set in
> production. If either is missing, the build silently runs in **unauthenticated
> demo mode** (no login, in-memory mock data) — anyone could reach the dashboard.
> `VITE_USE_BACKEND=1` (with the API/WS URLs) is separately required to route the
> app through the real backend instead of the mock provider.

The SPA now uses `createHttpProvider()` (REST + WS) instead of the mock.

### CORS / WebSocket origin
The backend reflects `ALLOWED_ORIGIN` for CORS and validates the same origin on the
WS upgrade. Set it to your exact Vercel origin (or a comma-separated list). For
cookie-based auth later, prefer a shared parent domain (`app.example.com` +
`api.example.com`) so cookies stay `SameSite=Lax`.

## 3 · Real device provider — Corellium (virtual iOS)

`PROVIDER=corellium` selects `server/src/provider/corellium-adapter.ts` (currently a
documented stub). To make it live you need (from Corellium sales/console):

| Variable | Value |
|---|---|
| `CORELLIUM_API_TOKEN` | API token (Bearer) |
| `CORELLIUM_PROJECT_ID` | target project for instances |

Then implement the adapter's lifecycle against the official SDK
(`@corellium/corellium-api`) per the mapping documented in the adapter's file
header. Until then keep `PROVIDER=simulated` — the app runs fully on the simulator.

## 4 · Content upload — Cloudflare R2 (when built)

Presigned-PUT uploads (S3-compatible). Provision an R2 bucket + token and set:
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.

## Local full-stack dev

```bash
npm run dev:all     # Fastify backend (:8787) + Vite web (:5173) together
```
`.env.local` (gitignored) sets `VITE_USE_BACKEND=1`; the Vite proxy forwards
`/v1` + `/ws` to the backend so the browser stays same-origin (no CORS).
