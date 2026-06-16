-- Phase 3B: TEMPORARY least-privilege READ-ONLY role for the SUPABASE SOURCE inventory.
-- Run by a Supabase admin (e.g. the `postgres` role) ON THE SOURCE (Supabase) DATABASE.
--
-- SECURITY:
--   * Replace <STRONG_RANDOM_PASSWORD> out-of-band (secrets manager / psql -v). NEVER commit a real password.
--   * Hand the resulting connection string to the operator ONLY via a local secure env var
--     (SUPABASE_DB_URL) — never via chat, Git, source files, logs, or the report.
--   * Adjust the database name if the Supabase database is not `postgres`.
--
-- The inventory pre-flight independently VERIFIES every property below and ABORTS on any failure
-- (not superuser; no CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS; not db/schema/table owner; not a
--  member of any privileged role; no CREATE on db/schemas; no write privilege on inspected tables;
--  default_transaction_read_only = on).

CREATE ROLE mobfleet_inv_ro LOGIN PASSWORD '<STRONG_RANDOM_PASSWORD>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;

-- Connect + schema usage only.
GRANT CONNECT ON DATABASE postgres TO mobfleet_inv_ro;
GRANT USAGE ON SCHEMA auth, public TO mobfleet_inv_ro;

-- SELECT on EXACTLY the four inspected source tables — nothing else.
GRANT SELECT ON auth.users, public.teams, public.team_members, public.team_invites TO mobfleet_inv_ro;

-- Defense in depth: default every transaction for this role to read-only.
ALTER ROLE mobfleet_inv_ro SET default_transaction_read_only = on;

-- Belt-and-suspenders: ensure NO create on the inspected schemas.
REVOKE CREATE ON SCHEMA auth, public FROM mobfleet_inv_ro;
