# Deploying the backend

The frontend (Vite SPA) already auto-deploys to **Vercel** on push to `master` and
runs the in-memory mock by default. To run the **real backend** in production you
deploy `server/` to an always-on host (Railway) and point the SPA at it.

> Vercel can't host the stateful WebSocket backend (serverless functions are
> short-lived), so the API lives on Railway; only the SPA stays on Vercel.

## 1 · Backend → Railway

1. Create a Railway project from the GitHub repo `0xDI/phone-farm-app`.
2. In the service settings, set **Root Directory = `server`** (Railway reads
   `server/railway.json` for build/start commands).
3. Add a **PostgreSQL** plugin → Railway injects `DATABASE_URL`.
4. Set service variables:
   | Variable | Value |
   |---|---|
   | `PROVIDER` | `simulated` (or `corellium` once wired) |
   | `ALLOWED_ORIGIN` | `https://phone-farm-app.vercel.app` |
   | `DATABASE_URL` | (auto from the Postgres plugin) — runtime app role |
   | `MIGRATION_DATABASE_URL` | dedicated migration role (pre-deploy only); see the runbook |
5. Deploy. Build runs `npm run build` (generates the Postgres Prisma client). The
   **pre-deploy** command `npm run migrate:deploy` applies versioned migrations
   (`prisma migrate deploy`) once per release — a failure aborts the deploy. The
   **start** command is server-only (`node dist/index.js`) and never mutates the
   schema. See [`server/ops/PRODUCTION_MIGRATION_RUNBOOK.md`](server/ops/PRODUCTION_MIGRATION_RUNBOOK.md)
   for the one-time baseline bootstrap. Note the public URL, e.g.
   `https://phone-farm-server.up.railway.app`.

## 2 · Frontend → Vercel

Set Production env vars (Project → Settings → Environment Variables), then redeploy
(Vite inlines `VITE_*` at build time):

| Variable | Value |
|---|---|
| `VITE_USE_BACKEND` | `1` |
| `VITE_API_URL` | `https://<railway-url>` |
| `VITE_WS_URL` | `wss://<railway-url>` |

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
