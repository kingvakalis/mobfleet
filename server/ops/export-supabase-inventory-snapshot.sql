-- Phase 3B: OFFLINE source snapshot export for the Supabase->Prisma inventory.
--
-- WHY: hosted Supabase does not let the dashboard `postgres` role grant USAGE on the managed
-- `auth` schema to a custom read-only role, so the inventory cannot read `auth.users` over a
-- least-privilege connection. Instead, a Supabase admin runs THIS single read-only statement in
-- the Supabase SQL Editor and saves the returned JSON locally; the inventory then runs in
-- offline-snapshot mode (no Supabase connection).
--
-- DATA MINIMIZATION: `authUsers` contains ONLY the closure of users relevant to this migration --
-- users referenced by team_members.user_id, teams.owner_user_id, or team_invites.invited_by, plus
-- existing auth users whose normalized (lower+trim) email matches a team_invites.email. Unrelated
-- auth users are NOT exported. Email matching only DECIDES inclusion (for conflict analysis); it
-- never merges users. Null references are ignored. Every JSON aggregate is ORDER BY id for a
-- deterministic snapshot.
--
-- SAFETY: one read-only SELECT (CTEs + a final SELECT) -- it creates/alters NO function, view,
-- table, role, policy, schema, or any other object, and writes nothing. Save the single `snapshot`
-- value to a LOCAL file named e.g. migration-source-snapshot.json (gitignored). Do NOT commit it.

WITH
  -- Auth-user ids directly referenced by the business tables (null references ignored).
  referenced_ids AS (
    SELECT user_id::text AS id FROM public.team_members WHERE user_id IS NOT NULL
    UNION
    SELECT owner_user_id::text AS id FROM public.teams WHERE owner_user_id IS NOT NULL
    UNION
    SELECT invited_by::text AS id FROM public.team_invites WHERE invited_by IS NOT NULL
  ),
  -- Distinct normalized invite recipient emails (lower + trim; blanks ignored).
  invite_emails AS (
    SELECT DISTINCT lower(btrim(email)) AS email
    FROM public.team_invites
    WHERE email IS NOT NULL AND btrim(email) <> ''
  ),
  -- The relevant auth-user closure: referenced by id, OR an existing auth user whose normalized
  -- email matches an invite recipient (inclusion only -- never a merge).
  relevant_users AS (
    SELECT u.*
    FROM auth.users u
    WHERE u.id::text IN (SELECT id FROM referenced_ids)
       OR lower(btrim(u.email)) IN (SELECT email FROM invite_emails)
  ),
  au AS (
    SELECT coalesce(json_agg(json_build_object(
      'id', r.id::text,
      'email', r.email,
      'emailConfirmedAt', r.email_confirmed_at,
      'fullName', coalesce(r.raw_user_meta_data ->> 'full_name', r.raw_user_meta_data ->> 'name'),
      'createdAt', r.created_at
    ) ORDER BY r.id), '[]'::json) AS data
    FROM relevant_users r
  ),
  t AS (
    SELECT coalesce(json_agg(json_build_object(
      'id', x.id::text,
      'name', x.name,
      'ownerUserId', x.owner_user_id::text,
      'createdAt', x.created_at
    ) ORDER BY x.id), '[]'::json) AS data
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
    ) ORDER BY x.id), '[]'::json) AS data
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
    ) ORDER BY x.id), '[]'::json) AS data
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
