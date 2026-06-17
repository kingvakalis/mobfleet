// Dedicated production migration runner for the Railway PRE-DEPLOY / release step.
//
// Runs ONLY `prisma migrate deploy --schema=prisma/schema.postgres.prisma` against a DEDICATED
// migration connection (MIGRATION_DATABASE_URL). It is intentionally minimal and FAILS CLOSED:
//   * MIGRATION_DATABASE_URL absent/blank      -> exit 1 (never falls back to DATABASE_URL).
//   * prisma migrate deploy non-zero / signal  -> exit non-zero (migration failure is FATAL).
//   * No `db push`, no `migrate resolve`, no `--accept-data-loss`, no timeout-then-continue.
// It NEVER prints the connection URL or credentials.
//
// Baseline registration (`prisma migrate resolve --applied 00000000000000_baseline`) is a
// SEPARATE, one-time, manually approved bootstrap action -- it is deliberately NOT performed here
// (see server/ops/PRODUCTION_MIGRATION_RUNBOOK.md).
//
// Railway wires this as the pre-deploy command (`npm run migrate:deploy`); it runs once per
// deployment, before the server starts. Application startup (node dist/index.js) never migrates.

import { spawnSync } from 'node:child_process'

const migrationUrl = process.env.MIGRATION_DATABASE_URL
if (!migrationUrl || migrationUrl.trim() === '') {
  console.error('[migrate:deploy] FATAL: MIGRATION_DATABASE_URL is not set. Refusing to run (fail closed).')
  console.error('[migrate:deploy] This command never falls back to DATABASE_URL (the runtime writer).')
  process.exit(1)
}

// The dedicated migration connection is exposed to prisma ONLY as the child process DATABASE_URL
// (the schema datasource reads env("DATABASE_URL")). The runtime DATABASE_URL is never used here.
// The URL is passed via the environment, never on the command line, and is never logged.
const childEnv = { ...process.env, DATABASE_URL: migrationUrl }

console.error('[migrate:deploy] running `prisma migrate deploy` (schema.postgres.prisma) against MIGRATION_DATABASE_URL')
const res = spawnSync(
  'npx',
  ['prisma', 'migrate', 'deploy', '--schema=prisma/schema.postgres.prisma'],
  { stdio: 'inherit', env: childEnv, shell: process.platform === 'win32' },
)

if (res.error) {
  console.error('[migrate:deploy] FATAL: failed to launch prisma:', res.error.message)
  process.exit(1)
}
if (res.status !== 0) {
  console.error(`[migrate:deploy] FATAL: prisma migrate deploy exited with ${res.status === null ? 'a signal' : 'code ' + res.status}. Aborting the release.`)
  process.exit(res.status === null ? 1 : res.status)
}
console.error('[migrate:deploy] OK: migrations applied.')
process.exit(0)
