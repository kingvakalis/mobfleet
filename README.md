# MobFleet — Cloud-Phone Fleet

A control-plane dashboard for a fleet of rented iOS cloud phones: watch the fleet as a
live node constellation, drill into any device, dispatch content-upload jobs at scale,
and provision/retire capacity — all visually.

**Live:** https://phone-farm-app.vercel.app

> **Source of truth.** The root application directories — [`src/`](src/),
> [`server/`](server/), and [`supabase/`](supabase/) — are the active MobFleet
> codebase. [`phone-farm-app/`](phone-farm-app/) is retained only as a
> legacy/reference copy; do not develop against it.

## Design

"Mission control meets Vercel" — pure-black cinematic canvas, hairline HUD framing,
monospace telemetry, and crisp geometric cards. All motion is expo-out, 60fps, and
respects `prefers-reduced-motion`.

## Features

- **Fleet graph** — every phone is a node (live screen, status ring, region) wired to a
  central orchestrator core. Pan/zoom/fit, warp-in on provision, dissolve on retire,
  data-pulses along active edges.
- **Device console** — double-click a phone for a right-side drawer with an interactive
  phone (tap · home · wake/lock · screenshot), full telemetry, and a live log stream.
- **Jobs** — Vercel-style pipeline table with filters, durations, retry, and a dispatch flow.
- **Scale** — provision/retire the pool with live animation and a max-capacity guard.
- **Command palette** — `⌘/Ctrl-K` for every action; fully keyboard-navigable.
- **Every state designed** — loading, empty, error, offline node, failed job.

## Stack

React 19 · TypeScript · Vite · Tailwind · React Flow (`@xyflow/react`) · Framer Motion ·
zustand · cmdk · self-hosted Geist / JetBrains Mono.

The entire backend is mocked behind a typed `ProviderClient`
([`src/lib/provider`](src/lib/provider)) with an in-memory adapter + a self-driving live
feed, so the UI runs standalone. Point that one seam at a real API to go live — the UI
doesn't change.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build
```

The design-system reference lives at `/#style`.

## Backend (`server/`)

A Fastify + Prisma control-plane API (multi-tenant, RBAC, REST `/v1/*` + a live
`/ws` feed). The frontend runs against the in-memory mock by default; point it at
the real backend with `VITE_USE_BACKEND=1` plus `VITE_API_URL` / `VITE_WS_URL`.

```bash
cd server
npm install
npm run dev        # tsx watch, SQLite (file:./dev.db), AUTH_PROVIDER=dev
npm run typecheck && npm test
```

Every setting is read from `process.env` with sensible local-dev defaults
(`server/src/env.ts`) — **no secrets are committed**:

| Var | Default (dev) | Notes |
| --- | --- | --- |
| `PORT` | `8787` | Railway injects this automatically. |
| `DATABASE_URL` | `file:./dev.db` | SQLite locally; a Postgres URL in prod. |
| `AUTH_PROVIDER` | `dev` locally / `supabase` in prod | `supabase` verifies real JWTs. |
| `SUPABASE_JWT_SECRET` | _(empty)_ | **Required** when `AUTH_PROVIDER=supabase`. |
| `PUBLIC_SERVER_URL` | _(derived in dev)_ | **Required in production** (pins the device-pairing QR target). |
| `ALLOWED_ORIGIN` | `*` | Comma-separated allowlist for CORS + the WS upgrade. |
| `ALLOW_INSECURE_DEV_AUTH` | `false` | Must be `1` to use `AUTH_PROVIDER=dev` (local only). |

Health check: `GET /healthz` → `200 {"status":"ok"}` (unauthenticated, no DB).

### Deploy to Railway

The server is containerized. The Docker **build context is the repo root** because
the server bundles shared TypeScript from `src/` — `esbuild` compiles
`server/src/index.ts` (and that shared code) into a self-contained
`server/dist/index.js` that runs as plain Node (`node dist/index.js`).

Build locally (run from the repo root):

```bash
docker build -f server/Dockerfile -t mobfleet-server .
docker run -p 8787:8787 \
  -e PORT=8787 -e AUTH_PROVIDER=dev -e ALLOW_INSECURE_DEV_AUTH=1 \
  -e DATABASE_URL='file:./dev.db' mobfleet-server
# → curl localhost:8787/healthz
```

On Railway:

1. Create a service from this repo and set its **Root Directory to the repo
   root** (`phone-farm-app`). Railway reads [`railway.toml`](railway.toml), which
   selects the Dockerfile builder (`server/Dockerfile`) and the `/healthz`
   health check.
2. Add a **PostgreSQL** plugin — Railway provides `DATABASE_URL`.
3. Set the service variables: `SUPABASE_JWT_SECRET`, `AUTH_PROVIDER=supabase`,
   `PUBLIC_SERVER_URL=https://<your-service>.up.railway.app`, and
   `ALLOWED_ORIGIN=https://<your-frontend-domain>`. (`PORT` is set by Railway.)
   Set secrets in the Railway dashboard — never in the repo.
4. Deploy. The container runs `npm run start:prod` → `prisma db push` (applies the
   schema) → `node dist/index.js`. Railway routes traffic once `/healthz` returns 200.

Point the Vercel frontend at it with `VITE_USE_BACKEND=1`,
`VITE_API_URL=https://<service>.up.railway.app`, and
`VITE_WS_URL=wss://<service>.up.railway.app`.
