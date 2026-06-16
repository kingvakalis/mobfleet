-- Phase 3B: OFFLINE source snapshot export for the Supabase->Prisma inventory.
--
-- WHY: hosted Supabase does not let the dashboard `postgres` role grant USAGE on the managed
-- `auth` schema to a custom read-only role, so the inventory cannot read `auth.users` over a
-- least-privilege connection. Instead, a Supabase admin runs THIS single read-only statement in
-- the Supabase SQL Editor and saves the returned JSON locally; the inventory then runs in
-- offline-snapshot mode (no Supabase connection).
--
-- SAFETY: one read-only SELECT (CTEs + a final SELECT) -- it creates/alters NO function, view,
-- table, role, policy, schema, or any other object, and writes nothing. Save the single `snapshot`
-- value to a LOCAL file named e.g. migration-source-snapshot.json (gitignored). Do NOT commit it.

WITH
  au AS (
    SELECT coalesce(json_agg(json_build_object(
      'id', u.id::text,
      'email', u.email,
      'emailConfirmedAt', u.email_confirmed_at,
      'fullName', coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
      'createdAt', u.created_at
    )), '[]'::json) AS data
    FROM auth.users u
  ),
  t AS (
    SELECT coalesce(json_agg(json_build_object(
      'id', x.id::text,
      'name', x.name,
      'ownerUserId', x.owner_user_id::text,
      'createdAt', x.created_at
    )), '[]'::json) AS data
    FROM public.teams x
  ),
  m AS (
    SELECT coalesce(json_agg(json_build_object(
      'id', x.id::text,
      'teamId', x.team_id::text,
      'userId', x.user_id::text,
      'role', x.role::text,
      'status', x.status,
      'email', x.email,
      'name', x.name,
      'invitedBy', x.invited_by::text,
      'scopeType', x.scope_type,
      'scopeGroups', x.scope_groups,
      'scopePhones', x.scope_phones,
      'overrides', x.overrides,
      'joinedAt', x.joined_at
    )), '[]'::json) AS data
    FROM public.team_members x
  ),
  i AS (
    SELECT coalesce(json_agg(json_build_object(
      'id', x.id::text,
      'teamId', x.team_id::text,
      'email', x.email,
      'role', x.role::text,
      'token', x.token,
      'status', x.status,
      'invitedBy', x.invited_by::text,
      'createdAt', x.created_at,
      'expiresAt', x.expires_at,
      'acceptedAt', x.accepted_at
    )), '[]'::json) AS data
    FROM public.team_invites x
  )
SELECT json_build_object(
  'snapshotVersion', 1,
  'source', 'supabase',
  'generatedAt', now(),
  'authUsers', (SELECT data FROM au),
  'teams', (SELECT data FROM t),
  'members', (SELECT data FROM m),
  'invites', (SELECT data FROM i)
) AS snapshot;
