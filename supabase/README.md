# Supabase (database + RLS)

The multi-tenant phone-farm database, enforced by **Postgres Row-Level
Security** so each team only ever sees its own rows — the isolation lives in the
database, not just the app layer.

```
supabase/
  migrations/20260614120000_init_phone_farm.sql   schema: enums, tables, FKs, indexes, RLS, triggers, grants
  seed.sql                                         demo data (2 teams → proves isolation); local dev only
```

## Schema

| table | purpose | key columns |
|---|---|---|
| `teams` | tenant / workspace | `id` (uuid pk), `name`, `owner_user_id → auth.users`, `created_at` |
| `team_members` | membership + role | `team_id`, `user_id → auth.users`, `role` enum `owner\|admin\|operator\|viewer`, `invited_at`, `joined_at`, unique `(team_id, user_id)` |
| `devices` | phones | `team_id`, `name`, `udid`, `platform`, `os_version`, `status` enum `online\|offline\|error\|busy\|warming`, `ip_address` (inet), `wda_port`, `last_heartbeat`, `created_at` |
| `automation_jobs` | runs | `team_id`, `device_id → devices`, `type`, `status` enum, `config` jsonb, `started_at`, `finished_at`, `error` |

All four tables carry `team_id`; UUID primary keys; FKs cascade from `teams`
(and `device_id` nulls out when a device is deleted). Indexes exist on `team_id`
and `(team_id, status)` for `devices` and `automation_jobs`, plus the
membership/FK lookups RLS relies on.

## RLS (tenant isolation)

RLS is enabled on every table. Policies use `SECURITY DEFINER` helpers
(`is_team_member`, `team_role_of`, `can_write_team`, `is_team_admin`) that read
`team_members` for `auth.uid()` — the definer rights let a policy on
`team_members` check membership without recursing into its own RLS.

- **Read**: any member of the row's team.
- **Write devices/jobs**: `owner`/`admin`/`operator` (viewers are read-only).
- **Manage members / update team / delete devices**: `owner`/`admin`.
- **Create team**: any authenticated user, only with themselves as `owner` — an
  `AFTER INSERT` trigger then makes them the first owner-member.
- **Delete team**: the owner only.

Invite *acceptance* (a user adding their own membership row) is intentionally not
permitted by the member-insert policy — route it through a `SECURITY DEFINER`
RPC or the server, since an invitee isn't yet an admin.

## Apply

```bash
# local (Docker): applies migrations + seed.sql
supabase db reset

# remote project
supabase link --project-ref <ref>
supabase db push
```

Client env (root `.env.example`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## Relationship to `server/` (Prisma/Fastify)

Two valid backends for the same tenancy model:

- **This (Supabase + RLS)** — the React client talks to Supabase directly with
  the user's JWT; the database enforces isolation. Simplest to operate.
- **`server/` (Prisma/Fastify)** — a Node API enforces isolation in the app
  layer (teamId-scoped queries) and runs the device simulation/provider loop.

They model the same domain; pick one as the source of truth. If you go
Supabase-direct, the device simulation/automation runner still needs a worker
(Edge Function / the existing server) — PostgREST only does CRUD.
