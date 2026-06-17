# Multi-tenancy & Auth

This server is a **multi-tenant SaaS backend**. Every tenant is a **Team**; every
user belongs to one or more teams through a **Membership** that carries their
**role**; and every fleet row (devices, jobs, proxies, automations) is scoped by
`teamId`. A request can only ever see and act on its own team's data.

> Status: the backend (this `server/`) is the security boundary and is fully
> implemented here. The deployed Vercel SPA still runs the in-memory mock
> provider; wiring the SPA to this server (login UI + team switcher) is the
> remaining **client** phase, described at the end.

## Tenancy model (Prisma)

```
Team 1───* Membership *───1 User
Team 1───* Invite
Team 1───* Device | Job | Proxy | Automation   (every row has teamId)
```

- **Team** — a tenant / workspace.
- **User** — one identity (`authProviderId` = the JWT `sub`), unique `email`.
- **Membership** — `(userId, teamId, role)`, unique per pair. Role is one of
  `owner | admin | manager | operator | viewer`.
- **Invite** — `(teamId, email, role, token, status, expiresAt)`.
- **Device / Job / Proxy / Automation** — composite primary keys
  `@@id([teamId, id])` (`[teamId, ip]` for Proxy) so two teams can never collide
  and a query that forgets the `teamId` filter cannot silently read another
  tenant.

Two schemas, identical models: `prisma/schema.prisma` (SQLite, dev) and
`prisma/schema.postgres.prisma` (Postgres, prod).

## Request flow

1. A global Fastify `onRequest` hook authenticates every route except
   `/v1/health` and the WS upgrade (`server/src/routes.ts`).
2. `authenticate()` (`src/auth/context.ts`) extracts the bearer token, verifies
   it (`src/auth/identity.ts` → `jwt.ts`), upserts the `User`, resolves the
   active `Membership`, and attaches `req.auth = { userId, teamId, role, … }`.
3. Each handler resolves **that team's engine** via
   `registry.get(req.auth.teamId)` (`src/tenancy/engine-registry.ts`). An engine
   is a **per-team** in-memory `FleetStore` + device provider + simulation loop.
   Because the store only ever holds its own team's rows (loaded/persisted via
   the `teamId`-scoped `repo`), cross-tenant leakage is impossible by
   construction.
4. Mutations additionally call `requirePermission(req, key)`, which runs the
   shared authorization engine (`src/lib/authorization/*`, reused verbatim
   server-side) against the actor's role.

## Auth (Supabase)

Auth is **Supabase Auth**. `AUTH_PROVIDER` selects how the JWT the browser sends
is verified — tenancy lives in **our** DB, so the token only supplies identity (a
stable `sub` + email):

| `AUTH_PROVIDER` | Verification | Notes |
|---|---|---|
| `supabase` | HS256 with `SUPABASE_JWT_SECRET` | Supabase access token; secret = Project Settings → API → JWT Secret |
| `dev` | **insecure decode-only** | local only — requires an explicit `ALLOW_INSECURE_DEV_AUTH=1` opt-in and is **forbidden in production** |

The browser obtains the JWT from `@supabase/supabase-js` (see the client's
`src/lib/supabase.ts` + `src/auth/`) and sends it as `Authorization: Bearer …`.

`assertAuthConfig()` runs **unconditionally at startup** and fails closed: an
unknown/typo'd `AUTH_PROVIDER`, a missing `SUPABASE_JWT_SECRET`, or `dev` without
the explicit opt-in all refuse to boot — so there is no code path by which a
misconfiguration silently reaches the signature-less verifier. Optional
`AUTH_AUDIENCE` / `AUTH_ISSUER` claim checks are recommended in prod; a present,
valid `exp` is **required** and `nbf` is enforced. No JWT library dependencies —
only Node's `crypto` (small, auditable trust surface; see `src/auth/jwt.ts`).

## Roles (RBAC)

Five system roles with an authority rank, defined in
`src/lib/authorization/roles.ts`:

| Role | Rank | Gist |
|---|---|---|
| owner | 100 | full authority incl. ownership/billing |
| admin | 80 | full ops + team admin; not ownership/billing |
| manager | 60 | operational lead for assigned scope |
| operator | 40 | hands-on device control |
| viewer | 20 | read-only |

Each route enforces a permission key (e.g. provision devices →
`phones.provision` (manager+, billable), retire device → `phones.retire`, assign
group → `phones.assign_group`, run task → `automations.run`, invite →
`team.invite`). Member/invite mutations enforce **anti-escalation** (you may
only assign a role you may assign and must **strictly outrank** the target),
plus **last-owner protection**, via `canAssignRole` / `canChangeRole` /
`canRemoveMember`.

## Invite flow

1. `POST /v1/team/invites { email, role }` — requires `team.invite`; the role
   must be one the inviter may assign (strictly below their authority; only an
   owner may invite an owner). Creates an `Invite` with a random token + expiry
   and emails an accept link (`src/mailer.ts`).
2. `GET /v1/team/invites` / `DELETE /v1/team/invites/:id` — list / revoke
   (revoke is scoped to the actor's team).
3. `POST /v1/invites/accept { token }` — the **authenticated** invitee accepts.
   The invitee's identity email must be **verified by the IdP** (`email_verified`
   / `email_confirmed_at` claim) **and** match the invite's email, so a leaked
   token can't be redeemed by someone who merely typed the victim's address. The
   role is fixed by the invite (no escalation). Creates the `Membership`.

Members: `GET /v1/team/members`, `PATCH /v1/team/members/:userId { role }`,
`DELETE /v1/team/members/:userId`.

## WebSocket

`GET /ws?token=…&teamId=…` — the upgrade is authenticated (browsers can't set
headers on a WS upgrade, so the token is passed as a query param) and the socket
subscribes to **only its team's** store; it receives only that team's snapshots.
The team's simulation loop runs only while it has ≥1 live subscriber.

## Environment

See `.env.example`. Key vars: `AUTH_PROVIDER`, `SUPABASE_JWT_SECRET`,
`AUTH_AUDIENCE`, `AUTH_ISSUER`, `APP_URL` (invite links),
`INVITE_TTL_MS`, `AUTO_PROVISION_TEAM`, `MAIL_TRANSPORT` / `RESEND_API_KEY`.

## Migration

The schema changed shape (new tenancy tables + `teamId` + composite keys), so an
existing dev `dev.db` must be reset:

```bash
cd server
npx prisma generate                 # regenerate the client
npx prisma migrate reset            # dev: drop + recreate (or: prisma db push)
# prod: Railway pre-deploy runs `npm run migrate:deploy` (prisma migrate deploy); app
# startup is server-only (node dist/index.js). See server/ops/PRODUCTION_MIGRATION_RUNBOOK.md
```

First login with no membership auto-creates a personal team (owner) when
`AUTO_PROVISION_TEAM=true` (default).

## Tests

`npm test` (Node's built-in runner via tsx) covers the security-load-bearing
pure logic: JWT verification (tamper/expiry/alg-confusion), the `teamId`-scoped
persist plan (no global wipe; every op carries `teamId`), and RBAC
anti-escalation / last-owner invariants.

## Client auth (built — Supabase)

The SPA auth layer is implemented:

- `src/lib/supabase.ts` — Supabase browser client from `VITE_SUPABASE_URL` +
  `VITE_SUPABASE_ANON_KEY` (auth is enabled iff both are set; otherwise the app
  runs in standalone mock/demo mode with no login).
- `src/auth/auth-context.tsx` — stores the session, pushes the Supabase JWT to
  the backend via `setAuthToken` (→ `Authorization: Bearer`), resolves
  `GET /v1/me` for `{ teamId, role }`, exposes `signIn/signUp/signOut`.
- `src/auth/protected-route.tsx` — redirects to `/login?redirect=…` when there's
  no session (passthrough when auth is unconfigured).
- `src/pages/{login,signup,invite}.tsx` + `main.tsx` routes: `/login`, `/signup`
  (creates the workspace with the user as **OWNER** via the `x-onboard-team-name`
  header on first `/v1/me`), and `/invite?token=…` (`POST /v1/invites/accept`).

To run against this server: set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`VITE_USE_BACKEND=1`, and `VITE_API_URL` / `VITE_WS_URL` (see root `.env.example`).

### Still optional (polish, not required to go live)

- Drive the in-app permission UI from the **server** role (`me.role`) instead of
  the local employee seed (the role is already on the auth context).
- A team switcher for multi-membership users (the seam is `setActiveTeam`).
