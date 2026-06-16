-- Phase 3B cleanup: remove the temporary SOURCE read-only role after the inventory.
-- Run by a Supabase admin ON THE SOURCE (Supabase) DATABASE. Adjust the db name if not `postgres`.

-- Terminate any active sessions for this temporary role first (scoped to mobfleet_inv_ro only).
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE usename = 'mobfleet_inv_ro'
  AND pid <> pg_backend_pid();

REVOKE ALL ON auth.users, public.teams, public.team_members, public.team_invites FROM mobfleet_inv_ro;
REVOKE ALL ON SCHEMA auth, public FROM mobfleet_inv_ro;
REVOKE ALL ON DATABASE postgres FROM mobfleet_inv_ro;
ALTER ROLE mobfleet_inv_ro RESET default_transaction_read_only;
DROP ROLE IF EXISTS mobfleet_inv_ro;
