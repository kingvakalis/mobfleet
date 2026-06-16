# Phase 3B — production read-only inventory: operator runbook

A **read-only, dry-run** Supabase→Prisma migration inventory. It never writes to either database,
never starts Phase 3C, and never resolves blockers. The detailed JSON report stays **local**
(gitignored) because it may contain private user/team identifiers.

## 1. Provision two TEMPORARY least-privilege read-only roles (administrator)
Run as a DB admin; replace placeholders out-of-band. **Never commit a real password.**
- Source (Supabase): [`source-readonly-role.sql`](./source-readonly-role.sql)
- Target (Prisma/Railway): [`target-readonly-role.sql`](./target-readonly-role.sql)

Each role: `CONNECT` + `USAGE` + `SELECT`-only on the inspected tables, `NOSUPERUSER NOCREATEDB
NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`, and `default_transaction_read_only = on`. Do
**not** use the normal application writer credentials.

## 2. Supply the two connection strings via LOCAL secure env vars only
Never paste them into chat, Git, source files, logs, or the report.
```bash
export SUPABASE_DB_URL='postgresql://mobfleet_inv_ro:***@<supabase-host>:5432/postgres'
export DATABASE_URL='postgresql://mobfleet_inv_ro:***@<railway-host>:5432/<db>'
```

## 3. Run the inventory exactly once
```bash
cd server
npm run migrate:inventory
```
What it enforces before reading anything (aborts on any failure):
- **Source:** one `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` transaction, mode proven via
  `current_setting`, on a single connection; the source role is verified least-privilege read-only
  on that same connection.
- **Target:** the role is verified least-privilege read-only (no superuser / CREATEDB / CREATEROLE
  / REPLICATION / BYPASSRLS; not db/schema/table owner; not a member of any privileged role; no
  CREATE on db/schemas; no INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on inspected tables;
  `default_transaction_read_only = on`).

Output: a redacted human summary on stdout + `migration-inventory.json` (gitignored). Emails are
masked, invite tokens are fingerprinted (last 4), connection strings/credentials are never printed.
Exit code is non-zero if blockers exist. Blockers are **not** auto-resolved.

## 4. Clean up the temporary roles (administrator)
- Source: [`source-cleanup.sql`](./source-cleanup.sql)
- Target: [`target-cleanup.sql`](./target-cleanup.sql)

## 5. Unset the env vars
```bash
unset SUPABASE_DB_URL DATABASE_URL
```
