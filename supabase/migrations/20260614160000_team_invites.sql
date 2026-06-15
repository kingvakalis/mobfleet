-- ════════════════════════════════════════════════════════════════════════════
-- team_invites — Supabase-native team invitations
-- ════════════════════════════════════════════════════════════════════════════
-- An admin/owner creates an invite (email + role); the invitee later redeems the
-- token via the accept_invite() RPC (next migration), which inserts their own
-- membership. We do NOT pre-insert a placeholder team_members row for invitees:
-- team_members.user_id is NOT NULL and the member-insert RLS policy forbids a
-- user inserting their own row, so the pending state lives HERE until accepted.
--
-- The token is a strong random secret (not a guessable uuid) since it is the
-- bearer credential embedded in the invite link.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.team_invites (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  email       text not null,
  role        public.team_role not null default 'operator',
  -- pgcrypto lives in the `extensions` schema on Supabase, so qualify the call
  -- (it isn't on the default search_path during a migration / at default-eval time).
  token       text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  status      text not null default 'pending',
  invited_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  constraint team_invites_status_check check (status in ('pending', 'accepted', 'revoked', 'expired'))
);

create index if not exists idx_team_invites_team   on public.team_invites (team_id);
create index if not exists idx_team_invites_token  on public.team_invites (token);
create index if not exists idx_team_invites_email  on public.team_invites (lower(email));
-- At most one OUTSTANDING invite per (team, email); accepted/revoked don't block
-- re-inviting. (Partial unique index on the pending state.)
create unique index if not exists uniq_pending_invite
  on public.team_invites (team_id, lower(email))
  where status = 'pending';

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table public.team_invites enable row level security;

-- Only admins/owner of the team may see or manage its invites. Invitees never
-- read this table directly — they redeem through the SECURITY DEFINER RPC, which
-- bypasses RLS. (A leaked token therefore can't be used to enumerate invites.)
create policy team_invites_select on public.team_invites
  for select using (public.is_team_admin(team_id));
create policy team_invites_insert on public.team_invites
  for insert with check (public.is_team_admin(team_id) and invited_by = auth.uid());
create policy team_invites_update on public.team_invites
  for update using (public.is_team_admin(team_id)) with check (public.is_team_admin(team_id));
create policy team_invites_delete on public.team_invites
  for delete using (public.is_team_admin(team_id));

grant select, insert, update, delete on public.team_invites to authenticated;

alter publication supabase_realtime add table public.team_invites;
