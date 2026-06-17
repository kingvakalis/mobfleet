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

## 2. Run the inventory exactly once (Windows PowerShell)
Supply the two read-only connection strings via LOCAL env vars only — never paste them into chat,
Git, source files, logs, or the report.
```powershell
$env:SUPABASE_DB_URL="<SOURCE_READONLY_URL>"
$env:DATABASE_URL="<TARGET_READONLY_URL>"

cd C:\Users\user\Desktop\PHONE-FARM-MAIN\server
npm run migrate:inventory

Remove-Item Env:SUPABASE_DB_URL
Remove-Item Env:DATABASE_URL
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

**Schema drift (safe):** the inventory inspects `pg_tables` + `information_schema.columns` first and
reports `expected` / `present` / `missing` / `extra` tables plus Phase 3A column/table presence.
- Each MISSING expected table -> `TGT_EXPECTED_TABLE_MISSING` blocker; the table is **skipped
  (never queried)**; analysis continues on every table that exists.
- **Pre-3A target tolerated:** if the Step 3A migration is not yet deployed (no
  `Team.supabaseTeamId`/`archivedAt`, no `MigrationRecord`, non-nullable `Invite.invitedByUserId`),
  each absent item -> `TGT_PHASE3A_SCHEMA_MISSING` blocker; those columns/tables are **never
  selected** (no crash); mapping/archival counts (mapped teams, artifact candidates) are reported as
  **"unavailable" — never silently zero**; and all safely-readable legacy data is still analyzed.

The inventory runs read-only regardless; Phase 3A must of course be applied (and verified) before the
actual migration/cutover, but the inventory will not crash if it has not been.

### Bash (optional)
```bash
export SUPABASE_DB_URL='<SOURCE_READONLY_URL>'
export DATABASE_URL='<TARGET_READONLY_URL>'
cd server
npm run migrate:inventory
unset SUPABASE_DB_URL DATABASE_URL
```

## 2b. Alternative SOURCE: offline Supabase snapshot (recommended for hosted Supabase)
Hosted Supabase does not allow granting USAGE on the managed `auth` schema to a custom read-only
role, so a live least-privilege read of `auth.users` is not possible. Instead, export a snapshot and
run the inventory **offline** (the TARGET is still read live + read-only):

1. In the **Supabase SQL Editor** (as the dashboard admin), run the single read-only statement
   [`export-supabase-inventory-snapshot.sql`](./export-supabase-inventory-snapshot.sql) and save the
   returned `snapshot` value to a LOCAL file `migration-source-snapshot.json` (gitignored — **never
   commit it**; it contains user ids + full invite tokens). The statement creates/alters nothing.
2. Run the inventory in offline mode (Windows PowerShell). No Supabase connection is made; this mode
   is mutually exclusive with `SUPABASE_DB_URL`:
```powershell
$env:DATABASE_URL="<TARGET_READONLY_URL>"

cd C:\Users\user\Desktop\PHONE-FARM-MAIN\server
npm run migrate:inventory -- --source-snapshot .\migration-source-snapshot.json

Remove-Item Env:DATABASE_URL
```
The report records `source mode: offline_snapshot`, the snapshot version + `generatedAt`, a
deterministic SHA-256 of the file, and the source row counts. The snapshot is strictly validated
(version / structure / required fields + types / duplicate ids / malformed timestamps / malformed
JSON) and the run **fails closed** on any problem. The target read-only pre-flight, schema-drift +
Phase 3A blockers, all conflict analysis, and masking/token-fingerprinting apply exactly as in live
mode. (Bash: `DATABASE_URL=… npm run migrate:inventory -- --source-snapshot ./migration-source-snapshot.json`.)

## 3. Clean up the temporary roles (administrator)
- Source: [`source-cleanup.sql`](./source-cleanup.sql)
- Target: [`target-cleanup.sql`](./target-cleanup.sql)
