-- ════════════════════════════════════════════════════════════════════════════
-- Add the 'manager' role to the team_role enum
-- ════════════════════════════════════════════════════════════════════════════
-- The frontend authorization engine (src/lib/authorization/roles.ts) and the
-- Fastify server both define five roles — owner | admin | manager | operator |
-- viewer — but the original Supabase enum only had four. Without 'manager',
-- inserting/updating a member with that role fails with 22P02 (invalid enum).
--
-- ALTER TYPE ... ADD VALUE must be its OWN migration: Postgres forbids using a
-- newly added enum value in the same transaction that added it. Keeping this
-- file isolated (no usage of 'manager' here) lets later migrations reference it.
-- 'manager' is ranked between admin and operator (see roles.ts rank 60).
-- ════════════════════════════════════════════════════════════════════════════

alter type public.team_role add value if not exists 'manager' after 'admin';
