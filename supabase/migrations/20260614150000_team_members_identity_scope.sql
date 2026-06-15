-- ════════════════════════════════════════════════════════════════════════════
-- team_members: denormalised identity + per-member access scope & overrides
-- ════════════════════════════════════════════════════════════════════════════
-- The roster UI needs each member's email + display name, but auth.users is not
-- directly selectable under RLS, so we DENORMALISE email/name onto team_members
-- (populated at invite-accept time and at owner-bootstrap — see below).
--
-- Full parity with the app's authorization model (src/lib/authorization): each
-- member carries an access SCOPE (workspace | assigned_groups | assigned_phones |
-- self) plus the groups/phones it covers, and per-permission OVERRIDES layered on
-- the role. These previously lived only in mock zustand / the Prisma server; now
-- they persist in the Supabase plane so role + scope + override edits survive.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.team_members
  add column if not exists email      text,
  add column if not exists name       text,
  add column if not exists invited_by uuid references auth.users (id) on delete set null,
  add column if not exists scope_type text not null default 'workspace',
  add column if not exists scope_groups jsonb not null default '[]'::jsonb,
  add column if not exists scope_phones jsonb not null default '[]'::jsonb,
  add column if not exists overrides    jsonb not null default '{}'::jsonb;

alter table public.team_members
  drop constraint if exists team_members_scope_type_check;
alter table public.team_members
  add constraint team_members_scope_type_check
  check (scope_type in ('workspace', 'assigned_groups', 'assigned_phones', 'self'));

-- New team → its creator becomes the first OWNER member. Extend the existing
-- bootstrap trigger to also stamp the owner's email + display name (read from
-- auth.users via the function's definer rights) so the owner shows up in the
-- roster with a real identity rather than a blank row.
create or replace function public.handle_new_team()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_email text;
  v_name  text;
begin
  select u.email,
         coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', u.email)
    into v_email, v_name
  from auth.users u
  where u.id = new.owner_user_id;

  insert into public.team_members (team_id, user_id, role, status, email, name, scope_type, joined_at)
  values (new.id, new.owner_user_id, 'owner', 'active', v_email, v_name, 'workspace', now())
  on conflict (team_id, user_id) do nothing;
  return new;
end;
$$;

-- Live roster: stream member changes (suspend / role / scope) to dashboards.
-- RLS still applies, so a subscriber only receives rows it may read.
alter publication supabase_realtime add table public.team_members;
