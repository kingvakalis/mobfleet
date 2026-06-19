# MobFleet staging stand-up — operator runbook (Option C, staging-first)

Stand up a NEW, isolated Railway staging service from `kingvakalis/mobfleet @ master`. Does NOT
touch the live `0xDI/phone-farm-app` service, run production migrations, or change prod Vercel env.
Repo side is ready (see "Repo-ready" below); the steps here are **dashboard/cloud actions** an
operator runs. Env template: [`/.env.staging.example`](../../.env.staging.example).

## 1. Service (Railway dashboard)
New project/environment named "staging" (NOT under the live `0xDI` project). New service:
- Repo `kingvakalis/mobfleet`, branch `master`, **Root Directory = repository root**.
- Builder `DOCKERFILE`, Dockerfile `server/Dockerfile`, build context = repo root.
- Pre-deploy `npm run migrate:deploy` · Start `node dist/index.js` · Healthcheck `/healthz` (already in `railway.toml`).

## 2. Database + roles (fresh + isolated)
Provision a **fresh, empty** staging Postgres (never the live DB). Create two roles
(template: [`migration-role.sql`](./migration-role.sql), adapted for staging — replace placeholders out of band):
- `mobfleet_migrator` — `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, `GRANT CONNECT`, `GRANT USAGE, CREATE ON SCHEMA public`.
- staging runtime role — same NO* flags, `GRANT CONNECT` + `GRANT USAGE ON SCHEMA public` (NO `CREATE`).
On a fresh DB the migrator creates+owns every table → **no `migrate resolve`, no ownership transfer needed** (those are prod-only).

## 3. Env vars (Railway staging service + staging frontend)
Set everything in [`/.env.staging.example`](../../.env.staging.example). Required to boot:
`NODE_ENV=production`, `AUTH_PROVIDER=supabase`, `SUPABASE_JWT_SECRET` (staging), `DATABASE_URL`
(runtime), `MIGRATION_DATABASE_URL` (migrator), `ALLOWED_ORIGIN`, `PUBLIC_SERVER_URL`, `APP_URL`,
`MAIL_TRANSPORT=console`. Recommended: a **dedicated staging Supabase project** (own JWT secret +
URL + anon key) so staging does not share the live user pool. Frontend `VITE_*` in a separate
staging build; `VITE_AUTH_SOURCE=supabase`.

## 4. Deploy + verify
Deploy. Railway pre-deploy runs `npm run migrate:deploy` → applies the full 5-migration chain on the
fresh DB (fail-closed on missing `MIGRATION_DATABASE_URL`). Then verify:
- **Healthcheck:** `GET $API/healthz` → `200 {"status":"ok"}`.
- **Migration history (as migrator):** `_prisma_migrations` has the 5, in order, finished, none rolled back:
  baseline · reconcile_legacy_objects · add_migration_mapping_and_audit_schema · add_team_notification_prefs · add_persistence_models.
- **No-op + empty diff:** re-run `migrate:deploy` → `No pending migrations to apply`; then
  `npx prisma migrate diff --from-url "$MIGRATION_DATABASE_URL" --to-schema-datamodel prisma/schema.postgres.prisma --exit-code` → exit 0.
- **Smoke:** run [`/tests/RELEASE_SMOKE.md`](../../tests/RELEASE_SMOKE.md) against the staging URL with a staging-Supabase JWT
  (health → `/v1/me` 401 unauth → onboarding idempotency → invite inspect/accept (Prisma) → role/403 → activity → email prefs → UI).

### Pre-flight rehearsal (recommended, on a DISPOSABLE DB before the staging deploy)
```
STAGING_MIGRATION_DATABASE_URL=<disposable migrator>  STAGING_DATABASE_URL=<disposable runtime> \
PROD_FINGERPRINT_HOST=<live host>  PROD_FINGERPRINT_DB=<live db> \
  node server/ops/staging-rehearsal.mjs        # expects RESULT: PASS (5 migrations / 19 tables, empty diff)
```

## Isolation (keep live untouched)
Separate service+env+project · separate Postgres (never live DB URLs) · separate migrator/runtime
roles · `ALLOWED_ORIGIN`/`PUBLIC_SERVER_URL`/`APP_URL` = staging only · `MAIL_TRANSPORT=console`
(no Resend key) · staging `VITE_*` only (no prod Vercel edits) · dedicated staging Supabase
recommended · never use `server/.env` / live secrets.

## Repo-ready (no change needed to deploy staging)
`railway.toml`, `server/Dockerfile`, `server/scripts/migrate-deploy.mjs`, the 5 additive migrations,
`migration-checksums.json` + `server/src/migrate/*.test.ts`, `/healthz`, `tests/RELEASE_SMOKE.md`,
and the de-staled `staging-rehearsal.mjs` (5/19, verified PASS on disposable Postgres).

## Future cutover (separate approval) — repoint live → `kingvakalis/mobfleet`
Only after: staging green ≥3–7 days (all smoke checks); migration verify green; verified live backup
+ one-time `migrate resolve --applied 00000000000000_baseline` plan (live built via `db push`);
dedicated prod migrator role + prod `MIGRATION_DATABASE_URL`; explicit `VITE_AUTH_SOURCE` decision
(stays `supabase` unless me-mode passed `e2e-me`); rollback proven; explicit human approval.
