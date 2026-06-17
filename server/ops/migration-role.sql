-- Dedicated Railway MIGRATION role for MobFleet -- SPECIFICATION + PROVISIONING TEMPLATE.
--
-- PURPOSE: a least-privilege role used ONLY by the pre-deploy `prisma migrate deploy`
-- (MIGRATION_DATABASE_URL). It must be able to evolve the schema; the normal RUNTIME application
-- role (DATABASE_URL) should NOT need ongoing DDL privileges.
--
-- DO NOT EXECUTE THIS IN CHECKPOINT 3. Run it later, once, as a DB admin, during the approved
-- production bootstrap (see PRODUCTION_MIGRATION_RUNBOOK.md). Replace every <PLACEHOLDER>
-- out-of-band. NEVER commit a real password, host, database name, URL, or any credential.
--
-- Privileges the migrator MUST have to apply the current chain
-- (00000000000000_baseline -> 20260616110000_reconcile_legacy_objects ->
--  20260616120000_add_migration_mapping_and_audit_schema):
--   * CONNECT to the database, USAGE on schema public.
--   * CREATE on schema public            -> CREATE TABLE (AgentCommand/DeviceSession/
--                                            TeamEmailSettings/MigrationRecord), CREATE INDEX,
--                                            and create the "_prisma_migrations" bookkeeping table.
--   * OWNERSHIP of the existing tables    -> ALTER TABLE / ADD + DROP CONSTRAINT / ALTER COLUMN
--                                            (Phase 3A relaxes the Invite FK + Team columns).
--     Only the table OWNER (or a superuser) may ALTER/drop-constraint a table; the audited live
--     tables are owned by `postgres`, so ownership must be transferred to the migrator (Option A,
--     recommended) -- this keeps the migrator NOSUPERUSER (least privilege).
--   * NO superuser / CREATEDB / CREATEROLE / REPLICATION / BYPASSRLS.

-- =====================================================================================
-- OPTION A (RECOMMENDED): the migrator OWNS the schema objects (NOSUPERUSER, least privilege).
-- Run as a current admin/owner (e.g. the bootstrap `postgres` role).
-- =====================================================================================

-- 1) Create the role.
CREATE ROLE mobfleet_migrator LOGIN PASSWORD '<MIGRATOR_PASSWORD>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

GRANT CONNECT ON DATABASE "<DB>" TO mobfleet_migrator;
GRANT USAGE, CREATE ON SCHEMA public TO mobfleet_migrator;

-- 2) Transfer ownership of the EXISTING audited tables so the migrator can ALTER them.
--    (Future objects the migrator creates are owned by it automatically.)
ALTER TABLE "Team"               OWNER TO mobfleet_migrator;
ALTER TABLE "User"               OWNER TO mobfleet_migrator;
ALTER TABLE "Membership"         OWNER TO mobfleet_migrator;
ALTER TABLE "AuditLog"           OWNER TO mobfleet_migrator;
ALTER TABLE "Invite"             OWNER TO mobfleet_migrator;
ALTER TABLE "Device"             OWNER TO mobfleet_migrator;
ALTER TABLE "Job"                OWNER TO mobfleet_migrator;
ALTER TABLE "Proxy"              OWNER TO mobfleet_migrator;
ALTER TABLE "Automation"         OWNER TO mobfleet_migrator;
ALTER TABLE "DevicePairingToken" OWNER TO mobfleet_migrator;
ALTER TABLE "DeviceApiKey"       OWNER TO mobfleet_migrator;

-- 3) Keep the RUNTIME application role working with DML ONLY (no DDL). The audited live runtime
--    currently connects as a privileged role; introducing a dedicated least-privilege runtime role
--    is a SEPARATE, later change. When you do, grant it (NOT the migrator) ongoing data access:
--    (templated -- replace <RUNTIME_ROLE>; safe to run now ONLY if <RUNTIME_ROLE> already exists)
-- GRANT USAGE ON SCHEMA public TO <RUNTIME_ROLE>;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO <RUNTIME_ROLE>;
-- ALTER DEFAULT PRIVILEGES FOR ROLE mobfleet_migrator IN SCHEMA public
--   GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO <RUNTIME_ROLE>;
--    ^ ensures tables CREATED by future migrations are automatically usable by the runtime role.
--    DO NOT grant the runtime role any DDL (CREATE/ALTER/DROP) -- that is the migrator's job.

-- =====================================================================================
-- OPTION B (FALLBACK, NOT recommended): grant the migrator membership in the current owner role.
-- Simpler, but if the owner is a superuser the migrator inherits superuser -> NOT least privilege.
-- =====================================================================================
-- GRANT "<CURRENT_TABLE_OWNER_ROLE>" TO mobfleet_migrator;

-- =====================================================================================
-- VERIFY (read-only) the migrator can do what it needs and nothing more.
-- =====================================================================================
-- SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
--   FROM pg_roles WHERE rolname = 'mobfleet_migrator';                       -- all the rol* flags = false
-- SELECT has_schema_privilege('mobfleet_migrator','public','CREATE') AS create_public; -- expect true
-- SELECT tablename, tableowner FROM pg_tables WHERE schemaname='public' ORDER BY 1;     -- owner = mobfleet_migrator

-- =====================================================================================
-- CLEANUP / REVOCATION GUIDANCE (do NOT remove privileges the live runtime needs).
-- =====================================================================================
-- The migrator role is needed for EVERY future deploy, so it normally STAYS. If you must remove it:
--   1) Reassign its owned objects to a stable owner FIRST (never DROP a role that owns objects):
--      REASSIGN OWNED BY mobfleet_migrator TO "<STABLE_OWNER_ROLE>";
--   2) Drop any privileges it was granted (this does NOT touch the runtime role's grants):
--      REVOKE ALL ON ALL TABLES IN SCHEMA public FROM mobfleet_migrator;
--      REVOKE ALL ON SCHEMA public FROM mobfleet_migrator;
--      REVOKE CONNECT ON DATABASE "<DB>" FROM mobfleet_migrator;
--      DROP OWNED BY mobfleet_migrator;   -- removes default-privilege entries it created
--   3) DROP ROLE mobfleet_migrator;
--   NEVER run DROP OWNED / REASSIGN against the runtime role, and never revoke the runtime role's
--   SELECT/INSERT/UPDATE/DELETE -- that would break the live application.
