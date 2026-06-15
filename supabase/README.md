# Supabase (database + RLS)

The multi-tenant phone-farm database, enforced by **Postgres Row-Level
Security** so each team only ever sees its own rows — the isolation lives in the
database, not just the app layer.

```
supabase/
  migrations/20260614120000_init_phone_farm.sql       schema: enums, tables, FKs, indexes, RLS, triggers, grants
  migrations/20260614130000_member_suspension.sql     team_members.status + status-aware membership helpers
  migrations/20260614140000_team_role_manager.sql     adds 'manager' to the team_role enum
  migrations/20260614150000_team_members_identity_scope.sql  email/name/invited_by + access scope + overrides
  migrations/20260614160000_team_invites.sql          team_invites table + admin-only RLS
  migrations/20260614170000_accept_invite_rpc.sql     accept_invite() SECURITY DEFINER redemption
  migrations/20260614180000_onboarding_responses.sql  first-run onboarding answers (per-user RLS)
  functions/send-invite/index.ts                      Edge Function — emails the invite link via Resend
  seed.sql                                            demo data (2 teams → proves isolation); local dev only
```

## Schema

| table | purpose | key columns |
|---|---|---|
| `teams` | tenant / workspace | `id` (uuid pk), `name`, `owner_user_id → auth.users`, `created_at` |
| `team_members` | membership + role + access | `team_id`, `user_id → auth.users`, `role` enum `owner\|admin\|manager\|operator\|viewer`, `status` `active\|suspended`, `email`, `name`, `invited_by`, `scope_type`, `scope_groups` jsonb, `scope_phones` jsonb, `overrides` jsonb, unique `(team_id, user_id)` |
| `team_invites` | pending invitations | `team_id`, `email`, `role`, `token` (unique secret), `status` `pending\|accepted\|revoked\|expired`, `invited_by`, `expires_at`, `accepted_at` |
| `onboarding_responses` | first-run discovery answers | `user_id → auth.users`, `team_id`, `full_name`, `company_name`, `goal`, `obstacles` text[], `past_experience`, `scale`, `referral_source`, `conversion_reasons` text[], `completed_at` |
| `devices` | phones | `team_id`, `name`, `udid`, `platform`, `os_version`, `status` enum `online\|offline\|error\|busy\|warming`, `ip_address` (inet), `wda_port`, `last_heartbeat`, `created_at` |
| `automation_jobs` | runs | `team_id`, `device_id → devices`, `type`, `status` enum, `config` jsonb, `started_at`, `finished_at`, `error` |

## Invitations & onboarding

- **Create invite** (admin/owner): the client inserts a `team_invites` row
  (`team_invites_insert` RLS = `is_team_admin`). The token is a strong random
  secret embedded in `…/invite?token=…`.
- **Email**: the `send-invite` Edge Function authorises the caller via their JWT
  (RLS lookup) and emails the link through **Resend**. The Team UI also shows a
  copy-to-clipboard link, so invites work even before email is configured.
  Secrets: `RESEND_API_KEY`, `INVITE_FROM_EMAIL`, `APP_URL`
  (`supabase secrets set …`); deploy with `supabase functions deploy send-invite`.
- **Accept**: `accept_invite(p_token)` (SECURITY DEFINER) validates the token +
  the caller's confirmed email, then inserts the membership — the only sanctioned
  path, since `team_members_insert` forbids a non-admin inserting their own row.
  A pending invitee is represented ONLY by a `team_invites` row (no placeholder
  member), so the roster merges members + pending invites for display.
- **Onboarding**: workspace creators answer the discovery wizard; answers land in
  `onboarding_responses` (a user may read/write only their own rows). Completion
  sets `user_metadata.onboarded = true`; invited users are marked onboarded on
  accept and skip the wizard.

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
