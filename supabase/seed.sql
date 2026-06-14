-- ════════════════════════════════════════════════════════════════════════════
-- Seed data — matches the multi-tenant phone-farm schema.
-- Runs automatically on `supabase db reset` (local). Two teams prove isolation:
-- Acme's members can never see Globex's rows (enforced by RLS, not the seed).
--
-- NOTE: auth.users rows are seeded ONLY for local dev so the FKs resolve. On a
-- hosted project, users come from real Supabase Auth sign-ups — seed just the
-- public.* tables there (or create users via the Auth admin API first).
-- ════════════════════════════════════════════════════════════════════════════

-- ── Demo auth users (LOCAL ONLY) ─────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'owner@acme.test', crypt('password123', gen_salt('bf')),
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"name":"Acme Owner"}', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'operator@acme.test', crypt('password123', gen_salt('bf')),
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"name":"Acme Operator"}', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'owner@globex.test', crypt('password123', gen_salt('bf')),
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"name":"Globex Owner"}', '', '', '', '')
on conflict (id) do nothing;

-- ── Teams (the AFTER INSERT trigger adds each owner as an owner-member) ───────
insert into public.teams (id, name, owner_user_id, created_at) values
  ('a0000000-0000-0000-0000-000000000001', 'Acme Operations',  '11111111-1111-1111-1111-111111111111', now()),
  ('b0000000-0000-0000-0000-000000000002', 'Globex Field Team','33333333-3333-3333-3333-333333333333', now())
on conflict (id) do nothing;

-- ── Extra membership (operator joins Acme) ───────────────────────────────────
insert into public.team_members (team_id, user_id, role, invited_at, joined_at) values
  ('a0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'operator', now() - interval '2 days', now() - interval '1 day')
on conflict (team_id, user_id) do nothing;

-- ── Devices (Acme) ───────────────────────────────────────────────────────────
insert into public.devices (id, team_id, name, udid, platform, os_version, status, ip_address, wda_port, last_heartbeat, created_at) values
  ('d0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'CAROLINA 1', '00008110-000a1c2e0e88401e', 'ios', 'iOS 18.1.1', 'online',  '10.0.0.11', 8100, now() - interval '20 seconds', now() - interval '9 days'),
  ('d0000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'CAROLINA 2', '00008120-001a44de3a02201e', 'ios', 'iOS 18.0',   'busy',    '10.0.0.12', 8101, now() - interval '15 seconds', now() - interval '9 days'),
  ('d0000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', 'LUCIA 1',    '00008101-0012650a1e88001e', 'ios', 'iOS 17.6',   'warming', '10.0.0.13', 8102, now() - interval '2 minutes',    now() - interval '6 days'),
  ('d0000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'IG FARM 1',  '00008030-000d2a9c0e88401e', 'ios', 'iOS 17.5.1', 'error',   '10.0.0.14', 8103, now() - interval '3 minutes',    now() - interval '5 days')
on conflict (id) do nothing;

-- ── Devices (Globex) — isolated from Acme by RLS ─────────────────────────────
insert into public.devices (id, team_id, name, udid, platform, os_version, status, ip_address, wda_port, last_heartbeat, created_at) values
  ('d0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000002', 'GLOBEX 1', '00008110-00099a1e0e88401e', 'ios', 'iOS 18.1.1', 'online', '10.0.1.11', 8100, now() - interval '10 seconds', now() - interval '2 days')
on conflict (id) do nothing;

-- ── Automation jobs (Acme) ───────────────────────────────────────────────────
insert into public.automation_jobs (id, team_id, device_id, type, status, config, started_at, finished_at, error, created_at) values
  ('30000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000a1', 'warmup', 'running',   '{"durationMin":30,"intensity":"low"}',  now() - interval '4 minutes', null, null, now() - interval '5 minutes'),
  ('30000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000a2', 'upload', 'succeeded', '{"mediaCount":3}',                      now() - interval '2 hours', now() - interval '118 minutes', null, now() - interval '2 hours'),
  ('30000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-000000000001', null,                                   'engage', 'queued',    '{"target":"reels"}',                    null, null, null, now() - interval '1 minute'),
  ('30000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000a4', 'upload', 'failed',    '{"mediaCount":1}',                      now() - interval '30 minutes', now() - interval '29 minutes', 'UPLOAD_TIMEOUT · proxy reset', now() - interval '31 minutes')
on conflict (id) do nothing;

-- ── Automation jobs (Globex) ─────────────────────────────────────────────────
insert into public.automation_jobs (id, team_id, device_id, type, status, config, started_at, finished_at, error, created_at) values
  ('30000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-0000000000b1', 'warmup', 'running', '{"durationMin":15}', now() - interval '1 minute', null, null, now() - interval '90 seconds')
on conflict (id) do nothing;
