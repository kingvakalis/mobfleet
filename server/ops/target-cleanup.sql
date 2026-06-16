-- Phase 3B cleanup: remove the temporary TARGET read-only role after the inventory.
-- Run by a target-DB admin ON THE TARGET (Prisma/Railway) DATABASE. Replace <DB>.

-- Terminate any active sessions for this temporary role first (scoped to mobfleet_inv_ro only).
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE usename = 'mobfleet_inv_ro'
  AND pid <> pg_backend_pid();

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM mobfleet_inv_ro;
REVOKE ALL ON SCHEMA public FROM mobfleet_inv_ro;
REVOKE ALL ON DATABASE "<DB>" FROM mobfleet_inv_ro;
ALTER ROLE mobfleet_inv_ro RESET default_transaction_read_only;
DROP ROLE IF EXISTS mobfleet_inv_ro;
