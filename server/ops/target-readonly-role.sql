-- Phase 3B: TEMPORARY least-privilege READ-ONLY role for the PRISMA TARGET inventory (Railway).
-- Run by a target-DB admin ON THE TARGET (Prisma/Railway) DATABASE.
--
-- SECURITY:
--   * Replace <STRONG_RANDOM_PASSWORD> and <DB> out-of-band. NEVER commit a real password.
--   * Hand the resulting connection string to the operator ONLY via a local secure env var
--     (DATABASE_URL for this dry-run) — never via chat, Git, source files, logs, or the report.
--   * Do NOT reuse the normal application writer credentials.
--
-- The inventory pre-flight independently VERIFIES every property below and ABORTS on any failure.

CREATE ROLE mobfleet_inv_ro LOGIN PASSWORD '<STRONG_RANDOM_PASSWORD>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;

GRANT CONNECT ON DATABASE "<DB>" TO mobfleet_inv_ro;
GRANT USAGE ON SCHEMA public TO mobfleet_inv_ro;

-- SELECT only. The inventory reads User/Team/Membership/Invite and COUNTS every Team-relation
-- table (Device, Job, Proxy, Automation, DevicePairingToken, DeviceApiKey, AuditLog, AgentCommand,
-- TeamEmailSettings, DeviceSession). Granting SELECT on ALL public tables is the simplest
-- read-only superset and stays correct if a new Team relation is added later.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO mobfleet_inv_ro;

ALTER ROLE mobfleet_inv_ro SET default_transaction_read_only = on;
REVOKE CREATE ON SCHEMA public FROM mobfleet_inv_ro;
