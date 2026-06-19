# Production migration runbook — Prisma migrate-deploy cutover

> **Status: PREPARATION ONLY (Checkpoint 3).** Nothing here has been executed against production.
> This runbook is the *later, separately approved* procedure to move the Railway/Prisma target from
> startup `db push` to versioned `prisma migrate deploy`, and to apply the audited migration chain.
> Throughout, **`VITE_AUTH_SOURCE` stays `supabase`** and **Phase 3C/3D do not run**.

## Active migration chain (must match the reviewed commits)
1. `00000000000000_baseline` — exact audited live schema (Checkpoint 1).
2. `20260616110000_reconcile_legacy_objects` — AgentCommand, DeviceSession, TeamEmailSettings, `Membership.overrides` (Checkpoint 2).
3. `20260616120000_add_migration_mapping_and_audit_schema` — Phase 3A (Team.supabaseTeamId/archivedAt, MigrationRecord, nullable Invite FK → `ON DELETE SET NULL`).
4. `20260617120000_add_team_notification_prefs` — additive nullable `Team.notificationPrefs JSONB` (transactional email prefs).
5. `20260617130000_add_persistence_models` — additive Account / WorkspaceSettings / Shift / UserPreference tables (+ indexes + FKs ON DELETE CASCADE).

## Deploy model (what changed in Checkpoint 3)
- **Application startup is SERVER-ONLY** (`node dist/index.js`). It never runs `db push`, `migrate`, or `resolve`, never swallows migration errors, never uses `--accept-data-loss`.
- **Schema changes apply once per release** via Railway's **pre-deploy** command `npm run migrate:deploy` → `node scripts/migrate-deploy.mjs` → `prisma migrate deploy --schema=prisma/schema.postgres.prisma`. A non-zero exit **aborts the release**; the previous deployment keeps serving.
- **Baseline registration is NOT automatic** — it is a one-time manual bootstrap (Section A).

## Environment-variable contract (set in Railway; never in the repo)
| Variable | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` | the running server (runtime) | normal app data access; **never** used for migrations |
| `MIGRATION_DATABASE_URL` | pre-deploy `npm run migrate:deploy` only | dedicated **migration role** (`mobfleet_migrator`, see `migration-role.sql`). If absent/blank the migrate command **fails closed** and never falls back to `DATABASE_URL` |
| `SUPABASE_JWT_SECRET`, `AUTH_PROVIDER=supabase`, `PUBLIC_SERVER_URL`, `ALLOWED_ORIGIN` | runtime | unchanged |
| `PORT` | runtime | injected by Railway |
| `VITE_AUTH_SOURCE=supabase` | frontend (Vercel) | **must remain `supabase`** through this entire runbook |

Set `MIGRATION_DATABASE_URL` and the migrator credentials only in the Railway dashboard / secret store. Do not print or commit them.

---

## STEP 3 — Final production drift gate (mandatory, READ-ONLY, run immediately before migrating)
Re-verify the world still matches the audit the plan was built on. **Run nothing that writes.** If any
check below trips, **STOP** — do not provision, do not register the baseline, do not deploy.

**One command** (read-only; aborts non-zero on any mismatch):
```
RAILWAY_RO_URL=…  SUPABASE_RO_URL=…  APPROVED_COMMIT=<reviewed sha> \
CONFIRM_VITE_AUTH_SOURCE_SUPABASE=1  CONFIRM_VERIFIED_BACKUP=1  CONFIRM_WRITE_FREEZE=1 \
  node server/ops/drift-gate.mjs
```
`RAILWAY_RO_URL`/`SUPABASE_RO_URL` must be **read-only** roles; the gate opens a `REPEATABLE READ
READ ONLY` transaction and never writes or prints URLs/credentials. (`node server/ops/drift-gate.mjs
--repo-only` runs just the code/checksum checks anywhere — used in CI.) It verifies:

1. **Railway row counts** — every public table that was audited empty must still be `0`.
   Run `server/ops/step0-production-schema-audit.sql` (read-only) via the Railway console; in its JSON,
   assert `row_counts` are all `0`.
2. **Railway schema fingerprint** — from the same audit JSON, assert `tables`, `columns`,
   `constraints`, and `indexes` are **identical** to the committed `server/ops/step0-production-audit.json`
   (a normalized comparison; ignore `meta`/timestamps). Any added/removed/changed object → abort.
3. **`_prisma_migrations` state** — `prisma_migrations.exists` must still be `false` (history has not
   been created yet). If it already exists, **stop and investigate** (someone migrated out of band).
4. **Supabase business counts** — read-only:
   ```sql
   SELECT (SELECT count(*) FROM public.teams)        AS teams,
          (SELECT count(*) FROM public.team_members) AS team_members,
          (SELECT count(*) FROM public.team_invites) AS team_invites;
   ```
   All three must be `0`. If any is non-zero, the migration is **no longer a no-op** — re-plan Phase 3C.
5. **Active migration order** — run `npm test` (server) — the `migration-order` guard asserts the exact
   active chain and that the 5 SQLite-era migrations stay archived. Must pass.
6. **Migration files match the reviewed commits** — `git fetch && git status` is clean and the
   `server/prisma/migrations/*` files equal the approved commit hashes (`git diff --stat <approved>..HEAD -- server/prisma/migrations`). Any drift → abort.
7. **Frontend flag** — confirm prod `VITE_AUTH_SOURCE=supabase` (unchanged).

**Abort the runbook if:** any audited-empty table now has rows · the Railway schema changed · Supabase
business records appeared · `_prisma_migrations` unexpectedly exists/changed · migration files differ
from the reviewed commits · `VITE_AUTH_SOURCE` is not `supabase`.

---

## A. One-time baseline registration (MANUAL bootstrap — run ONCE, never in pre-deploy)
Because production already contains the baseline schema (built earlier by `db push`), register the
baseline as *already applied* so `migrate deploy` does not try to recreate it. Run as the migrator:
```
DATABASE_URL="$MIGRATION_DATABASE_URL" \
  npx prisma migrate resolve --applied 00000000000000_baseline --schema=prisma/schema.postgres.prisma
```
This is **not** part of `npm run migrate:deploy` and must never be automated into the deploy path.

## B. Normal ongoing deployment (automatic, every release)
Railway runs this as the pre-deploy command; nothing else is needed for future migrations:
```
npm run migrate:deploy        # -> prisma migrate deploy --schema=prisma/schema.postgres.prisma
```

---

## Production execution stages (later, separately approved) — STOP after every stage
Each stage ends with a **STOP**: do not continue automatically if any check fails. Resume only after a
human confirms the stage's success criteria.

### Stage A — Backup, freeze, drift gate
- Take a **verified** database backup and confirm a tested restore point.
- **Freeze** team/onboarding/invite writes (maintenance flag / RLS guard) for a quiescent source.
- Run the **drift gate** (STEP 3, one command). It must print `PASS`.
- **STOP.** Proceed only if backup verified, freeze active, and the gate passed.

### Stage B — Provision / verify the production migrator role
- Provision/verify `mobfleet_migrator` per `server/ops/migration-role.sql` (Option A; NOSUPERUSER, owns
  the tables). Verify all `pg_roles` attribute flags are false and it has `CREATE` on `public`.
- **STOP.** Proceed only if the role verification is clean.

### Stage C — Set the migration secret
- Set `MIGRATION_DATABASE_URL` (the migrator) securely in Railway. Leave `DATABASE_URL` (runtime) as-is.
  Never print or commit it.
- **STOP.** Proceed only once the variable is present in the production service.

### Stage D — One-time baseline registration
- Run **Section A** once: `prisma migrate resolve --applied 00000000000000_baseline` (as the migrator).
- **STOP.** Proceed only if `_prisma_migrations` now contains the baseline row, marked applied, not rolled back.

### Stage E — Apply migrations
- Trigger the deploy; Railway's pre-deploy runs **Section B** (`npm run migrate:deploy`). A non-zero exit
  **aborts the release** (server does not start) — that is the desired fail-closed behavior.
- **STOP.** Proceed only if the pre-deploy step exited 0.

### Stage F — Verify history + empty diff
- `_prisma_migrations` contains exactly, in order, all `finished`, none rolled back:
  `00000000000000_baseline`, `20260616110000_reconcile_legacy_objects`, `20260616120000_add_migration_mapping_and_audit_schema`, `20260617120000_add_team_notification_prefs`, `20260617130000_add_persistence_models`.
- `prisma migrate diff --from-url "$MIGRATION_DATABASE_URL" --to-schema-datamodel prisma/schema.postgres.prisma --exit-code` → **empty** (exit 0).
- **STOP.** Proceed only on exact history + empty diff.

### Stage G — Phase 3B inventory: zero schema blockers
- Re-run the read-only Phase 3B inventory against the (now-migrated) target → **zero schema blockers**.
- **STOP.** Proceed only on zero blockers.

### Stage H — Health checks + unfreeze
- Confirm the new deployment started and `/healthz` is green; then **unfreeze** writes.
- **STOP.** Proceed only if healthy.

### Stage I — Keep the flag; defer the rest
- Keep `VITE_AUTH_SOURCE=supabase`.
- **Phase 3C** is a **no-op** ONLY after re-confirming Supabase *and* Prisma are both still empty.
- **Phase 3D** only via a later, separate checkpoint. **STOP** here.

## Rollback (primary = restore from backup)
- **Primary: restore the Stage-A backup** and redeploy the prior release. Because the migrations are
  additive on an empty database, this is clean and lossless. This is the proven rollback (rehearsed in
  staging — restore into an isolated DB and compare schema + counts to the pre-migration baseline).
- **Reverse SQL (staging/test aid ONLY — NOT the production rollback path).** For rehearsals; safe only
  under the stated preconditions:
  - `DROP TABLE "AgentCommand", "DeviceSession", "TeamEmailSettings", "MigrationRecord";` — only while empty.
  - `ALTER TABLE "Membership" DROP COLUMN "overrides";` — additive/nullable.
  - `ALTER TABLE "Team" DROP COLUMN "supabaseTeamId", DROP COLUMN "archivedAt";` — only if unused.
  - Restore `Invite_invitedByUserId_fkey` → `ON DELETE RESTRICT` + `invitedByUserId NOT NULL` — only with
    zero NULL `invitedByUserId` rows.

## Staging rehearsal (Checkpoint 4) — run BEFORE the production window, on an ISOLATED Railway staging DB
Provision a Railway **staging** environment fully separate from production (separate Postgres, separate
service, no shared `DATABASE_URL`/`MIGRATION_DATABASE_URL`, no production secrets, `VITE_AUTH_SOURCE=supabase`,
no production traffic/domain). Provision a staging migrator with `server/ops/migration-role.sql` adapted
for staging (e.g. role `mobfleet_migrator` in the staging DB; a **distinct** staging runtime role with DML
only). Then, from the repo:
```
STAGING_MIGRATION_DATABASE_URL=<staging migrator>  STAGING_DATABASE_URL=<staging runtime> \
PROD_FINGERPRINT_HOST=<prod host>  PROD_FINGERPRINT_DB=<prod db> \
  node server/ops/staging-rehearsal.mjs
```
It proves staging ≠ production (sanitized fingerprints; refuses a production target), reproduces the
audited baseline (parity vs `step0-production-audit.json`, all empty, `_prisma_migrations` absent),
verifies the least-privilege migrator role, registers the baseline, runs `npm run migrate:deploy`
(reconcile → Phase 3A in order), proves a second deploy is a no-op, and verifies the completed schema +
exactly five clean history rows + an empty diff — emitting **redacted** evidence (no URLs/credentials).
Separately rehearse the **backup → migrate → restore-into-isolated-DB → compare** rollback. Only after a
green staging rehearsal should the production stages above be scheduled.

### Staging migration-role note
Use `server/ops/migration-role.sql` verbatim against the **staging** database (replace `<DB>` and
`<MIGRATOR_PASSWORD>` with staging values). Keep the staging migrator and staging runtime roles distinct,
exactly as in production. Never reuse production role passwords in staging.
