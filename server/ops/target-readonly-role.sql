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

-- SELECT on EXACTLY the tables the inventory reads (derived from the implementation):
--   * target.ts findMany:                     "User", "Team", "Membership", "Invite"
--   * relations.ts countChildrenByRelation
--     (every Team-FK relation, from the DMMF): "Device", "Job", "Proxy", "Automation",
--     "DevicePairingToken", "DeviceApiKey", "AuditLog", "AgentCommand", "TeamEmailSettings",
--     "DeviceSession" (plus "Membership"/"Invite", already listed above)
--   * read-only pre-flight inspects:           "Team", "Membership", "Invite", "User" (already above)
-- NOT granted: "MigrationRecord" (no Team relation; the inventory never reads it) or any other table.
-- Names are double-quoted because Prisma uses case-sensitive PascalCase table names.
GRANT SELECT ON
  public."AgentCommand", public."AuditLog", public."Automation", public."Device",
  public."DeviceApiKey", public."DevicePairingToken", public."DeviceSession", public."Invite",
  public."Job", public."Membership", public."Proxy", public."Team",
  public."TeamEmailSettings", public."User"
TO mobfleet_inv_ro;

ALTER ROLE mobfleet_inv_ro SET default_transaction_read_only = on;
REVOKE CREATE ON SCHEMA public FROM mobfleet_inv_ro;
