# Production migration runbook — Prisma migrate-deploy cutover

> **Status: PREPARATION ONLY (Checkpoint 3).** Nothing here has been executed against production.
> This runbook is the *later, separately approved* procedure to move the Railway/Prisma target from
> startup `db push` to versioned `prisma migrate deploy`, and to apply the audited migration chain.
> Throughout, **`VITE_AUTH_SOURCE` stays `supabase`** and **Phase 3C/3D do not run**.

## Active migration chain (must match the reviewed commits)
1. `00000000000000_baseline` — exact audited live schema (Checkpoint 1).
2. `20260616110000_reconcile_legacy_objects` — AgentCommand, DeviceSession, TeamEmailSettings, `Membership.overrides` (Checkpoint 2).
3. `20260616120000_add_migration_mapping_and_audit_schema` — Phase 3A (Team.supabaseTeamId/archivedAt, MigrationRecord, nullable Invite FK → `ON DELETE SET NULL`).

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

## Full production sequence (later, separately approved)
1. **Backup**: confirm a verified database backup + a tested restore point (primary rollback).
2. **Freeze**: disable team/onboarding/invite writes (maintenance flag / RLS guard) for a quiescent source.
3. **Drift gate**: run STEP 3 above; proceed only if every check passes.
4. **Migration role**: provision/verify `mobfleet_migrator` per `server/ops/migration-role.sql` (Option A; NOSUPERUSER, owns the tables). Verify its `pg_roles` flags are all false.
5. **Secrets**: set `MIGRATION_DATABASE_URL` (migrator) securely in Railway. Leave `DATABASE_URL` as-is.
6. **Register baseline** (Section A) — once: `prisma migrate resolve --applied 00000000000000_baseline`.
7. **Deploy migrations** (Section B): `prisma migrate deploy` → applies `reconcile` then `phase3a` in order.
8. **Confirm history**: `_prisma_migrations` contains exactly, in order:
   `00000000000000_baseline`, `20260616110000_reconcile_legacy_objects`, `20260616120000_add_migration_mapping_and_audit_schema` (none rolled back).
9. **Schema diff**: `prisma migrate diff --from-url "$MIGRATION_DATABASE_URL" --to-schema-datamodel prisma/schema.postgres.prisma --exit-code` → must be **empty** (exit 0).
10. **Inventory**: re-run the Phase 3B read-only inventory → **zero schema blockers**.
11. **Health**: confirm the new deployment started and `/healthz` is green; unfreeze writes.
12. **Flag**: keep `VITE_AUTH_SOURCE=supabase`.
13. **Phase 3C**: treat as a **no-op** ONLY after re-confirming Supabase *and* Prisma are both still empty.
14. **Phase 3D**: only via a later, separate checkpoint.

## Rollback
- **Primary: restore from the verified backup** (step 1) and redeploy the prior release. Because the
  migrations are additive on an empty database, this is clean and lossless.
- **Reverse SQL (staging/test aid ONLY — not the production path).** Documented for rehearsal; safe
  **only** under the stated preconditions (verify before use):
  - `DROP TABLE "AgentCommand", "DeviceSession", "TeamEmailSettings", "MigrationRecord";`
    — safe only while those tables are **empty**.
  - `ALTER TABLE "Membership" DROP COLUMN "overrides";`
    — safe only if nothing depends on it (it is additive/nullable).
  - `ALTER TABLE "Team" DROP COLUMN "supabaseTeamId", DROP COLUMN "archivedAt";`
    — safe only if unused.
  - Restoring `Invite_invitedByUserId_fkey` to `ON DELETE RESTRICT` + `invitedByUserId NOT NULL`
    — safe **only** if there are zero NULL `invitedByUserId` rows.
  In production, prefer the backup restore; reverse SQL is for staging rehearsals so the team has
  practiced the shape of a rollback.
