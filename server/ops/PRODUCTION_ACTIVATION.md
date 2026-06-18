# Production activation runbook — 4th migration (`20260617120000_add_team_notification_prefs`)

> **Status: PREPARATION ONLY.** Nothing here has been executed against production.
> This is the *separately approved* operator procedure to ship the fourth committed
> migration — a single additive, nullable column `Team.notificationPrefs JSONB`.
> It assumes the first three migrations are **already deployed** in production via the
> [Prisma migrate-deploy cutover](./PRODUCTION_MIGRATION_RUNBOOK.md) and that the
> deploy model (server-only startup; pre-deploy `npm run migrate:deploy`; manual
> baseline registration) is already in place. `VITE_AUTH_SOURCE` stays `supabase`.

## What this release does (and why it is low-risk)
The only schema change is:
```sql
ALTER TABLE "Team" ADD COLUMN "notificationPrefs" JSONB;
```
- **Additive + nullable + no default.** Postgres adds a metadata-only nullable column —
  no table rewrite, no row locks beyond a brief `ACCESS EXCLUSIVE` on `Team`, no backfill.
- **`NULL` means "all defaults"** (every transactional email enabled). The application
  (`server/src/email-settings.ts → normalizeEmailPreferences`) coerces `NULL`/partial blobs
  to the full default set, so **existing rows need no migration** and the running server is
  unaffected until it reads the column.
- **Backward compatible.** The currently-running release does not reference the column, so a
  pre-deploy that adds it cannot break the live deployment if the app rollout is delayed.

**Rehearsed offline before this runbook.** `node server/scripts/prod-readiness-rehearsal.mjs`
boots a disposable embedded Postgres and proves, with redacted evidence:
- **A (fresh):** all four migrations apply, a second `migrate deploy` is a no-op, `migrate diff
  --exit-code` is empty.
- **B (prod-shaped):** apply the first 3 → seed `Team` rows → apply ONLY the 4th → the rows
  survive, their `notificationPrefs` is `NULL`, the column is writable, and the diff is empty.

## Environment-variable contract (unchanged from the cutover runbook)
| Variable | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` | running server (runtime role) | app data access; **never** used for migrations |
| `MIGRATION_DATABASE_URL` | pre-deploy `npm run migrate:deploy` only | dedicated migrator role; **fails closed** if absent |
| `VITE_AUTH_SOURCE=supabase` | frontend | **must remain `supabase`** |

Set secrets only in the Railway dashboard / secret store. Never print or commit them.

---

## Pre-activation checklist (READ-ONLY — run nothing that writes)
1. **Reviewed commit is deployed-from.** `git fetch && git status` clean; the
   `server/prisma/migrations/*` and `server/ops/migration-checksums.json` files equal the
   approved commit. `git diff --stat <approved>..HEAD -- server/prisma/migrations` is empty.
2. **Active chain guard passes.** From `server/`: `npm test` — `migration-order` and
   `migration-checksums` assert the exact four-migration chain and the checksum manifest.
3. **First three already applied in prod.** `_prisma_migrations` contains exactly, in order,
   all finished / none rolled back:
   `00000000000000_baseline`, `20260616110000_reconcile_legacy_objects`,
   `20260616120000_add_migration_mapping_and_audit_schema`. The 4th must be **absent**
   (this release applies it). If the 4th is already present, **STOP** — it was deployed out of band.
4. **Offline rehearsal is green.** `node server/scripts/prod-readiness-rehearsal.mjs` prints
   `RESULT: PASS` on this commit.
5. **Pre-migration `Team` count captured.** Record `SELECT count(*) FROM "Team";` via a
   READ-ONLY role — used to confirm zero row loss in Stage 4.

**Abort if:** files differ from the reviewed commit · the guard tests fail · the 4th migration is
already applied · the rehearsal is not green · `VITE_AUTH_SOURCE` is not `supabase`.

---

## Activation stages — STOP after every stage

### Stage 1 — Backup first (mandatory)
- Take a **verified** database backup and confirm a tested restore point (note the backup id /
  timestamp / LSN). Confirm a restore was tested into an isolated DB at least once (rehearsal).
- **STOP.** Proceed only with a verified, restorable backup in hand.

### Stage 2 — Confirm migrator secret + role
- Confirm `MIGRATION_DATABASE_URL` is set to the least-privilege migrator (NOSUPERUSER, owns the
  tables, `CREATE` on `public`). The runtime `DATABASE_URL` must remain the DML-only role.
- **STOP.** Proceed only if the migrator is present and least-privilege.

### Stage 3 — Apply the 4th migration (automatic via pre-deploy)
- Trigger the deploy. Railway's pre-deploy runs `npm run migrate:deploy` →
  `prisma migrate deploy --schema=prisma/schema.postgres.prisma`, which applies **only the one
  pending migration**. A non-zero exit **aborts the release** (server does not start) — the
  desired fail-closed behavior; the previous deployment keeps serving.
- **STOP.** Proceed only if the pre-deploy step exited 0.

### Stage 4 — Verify (history, column, zero row loss, empty diff)
- `_prisma_migrations` now contains all **four** migrations in order, finished, none rolled back —
  the 4th being `20260617120000_add_team_notification_prefs`.
- Column exists and is nullable (READ-ONLY):
  ```sql
  SELECT data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='Team' AND column_name='notificationPrefs';
  -- expect: jsonb | YES | (null)
  ```
- **Zero row loss:** `SELECT count(*) FROM "Team";` equals the pre-migration count from the
  checklist, and `SELECT count(*) FROM "Team" WHERE "notificationPrefs" IS NULL;` equals it too
  (every pre-existing row is `NULL` = all defaults).
- Empty diff:
  ```
  prisma migrate diff --from-url "$MIGRATION_DATABASE_URL" \
    --to-schema-datamodel prisma/schema.postgres.prisma --exit-code   # exit 0 (empty)
  ```
- **STOP.** Proceed only on: four-row clean history · jsonb nullable column · zero row loss ·
  empty diff.

### Stage 5 — Health check
- Confirm the new deployment started and `/healthz` is green. Spot-check that Email Settings
  preferences read/write works (the feature that consumes the column).
- Keep `VITE_AUTH_SOURCE=supabase`. **STOP.** Done when healthy.

---

## Rollback (backup-first)

### Primary — restore from the Stage-1 backup
Restore the verified Stage-1 backup and redeploy the prior release. Because the change is a single
additive nullable column, this is clean and lossless. This is the proven rollback path; rehearse the
**backup → migrate → restore-into-isolated-DB → compare schema + counts** loop before the window.

### Secondary — forward-safe reverse SQL (only if a full restore is not warranted)
The column is additive and nullable, so it can be dropped without data loss to **other** columns.
This **discards any `notificationPrefs` values written since the migration** (acceptable: `NULL`
restores default behavior). Run as the migrator, only after confirming no in-flight writes depend
on it:
```sql
ALTER TABLE "Team" DROP COLUMN "notificationPrefs";
```
Then mark the migration rolled back so history stays truthful:
```
DATABASE_URL="$MIGRATION_DATABASE_URL" \
  npx prisma migrate resolve --rolled-back 20260617120000_add_team_notification_prefs \
  --schema=prisma/schema.postgres.prisma
```
After either path, re-run Stage 4's verification (history + diff) to confirm a consistent state.

> **Preference order:** backup-restore is the canonical rollback. Use the reverse SQL only when a
> full restore would cost more than the (zero-data-loss) column drop, and only with operator sign-off.
