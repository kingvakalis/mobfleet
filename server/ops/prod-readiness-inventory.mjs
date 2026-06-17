// PRODUCTION READINESS INVENTORY — read-only row counts, DELIVER-ONLY.
//
// PURPOSE: before the Supabase->Prisma auth cutover (Phase 3C), an operator must know
// exactly how many business records exist on each side. This tool emits a REDACTED
// count snapshot in the COMBINED shape the deterministic classifier
// (ops/phase3c-classify.mjs) consumes, so the cutover decision is made from evidence.
//
// SAFETY (why it is "deliver-only"):
//   * One transaction per store: REPEATABLE READ, READ ONLY — the DB rejects any write
//     and the snapshot is a single consistent MVCC view.
//   * ONLY `SELECT count(*)` per table (+ a read-only to_regclass existence probe).
//   * Prints NO connection URL, NO credentials, NO row contents — only table => count.
//   * The SUBAGENT never runs this against production. An operator runs it later with
//     DEDICATED READ-ONLY roles (provision via ops/target-readonly-role.sql and
//     ops/source-readonly-role.sql).
//
// TLS: derived from the URL's `sslmode` by pg-connection-string — we do NOT hand-roll
// TLS. Verification is STRICT by default (no sslmode / require / verify-full verify the
// server cert). It is relaxed (rejectUnauthorized:false) ONLY when the URL explicitly
// sets `sslmode=no-verify`. Railway's TCP proxy presents a SELF-SIGNED cert, so the
// Railway/Prisma URL needs `?sslmode=no-verify`; managed Supabase keeps `sslmode=require`.
//
// REQUIRED ENV (both OPTIONAL; an unset store is reported "unavailable" — NEVER zero):
//   PRISMA_RO_URL    read-only Prisma/Railway role URL (append ?sslmode=no-verify).
//   SUPABASE_RO_URL  read-only Supabase role URL (?sslmode=require). (auth.users is read
//                    separately via ops/export-supabase-inventory-snapshot.sql by an admin.)
//
// EXECUTABLE SEQUENCE (no hosted-secret changes — read-only inventory only):
//   1. Provision the two read-only roles (ops/*-readonly-role.sql), as a DB admin.
//   2. PRISMA_RO_URL="…?sslmode=no-verify" SUPABASE_RO_URL="…?sslmode=require" \
//        node ops/prod-readiness-inventory.mjs > counts.json
//   3. node ops/phase3c-classify.mjs < counts.json        # SAFE_NOOP (0) | BLOCK (1) | UNVERIFIED (1)
//   4. Clean up the read-only roles (ops/*-cleanup.sql).
//
// OUTPUT: JSON { generatedAt, prisma:<counts>|{unavailable}, supabase:<counts>|{unavailable} }.
//   A <counts> object maps "<table>" => number (rows) | null (table absent). A side that
//   was not inventoried is { unavailable: "<reason>" } so the classifier FAILS CLOSED
//   (an un-inventoried side can never be mistaken for "empty / safe").
//
// HUMAN-ONLY follow-ups (NOT part of this tooling; never executed here): if a real Resend
// API key was ever exposed/copied/shared, rotate it in the provider console. This script
// neither reads nor changes any secret.

import pgConnectionString from 'pg-connection-string'
import pg from 'pg'

const { parse } = pgConnectionString

// The 13 Prisma BUSINESS tables (tenant/business data). Bookkeeping tables
// (MigrationRecord, _prisma_migrations) are intentionally EXCLUDED — they never gate the
// cutover (see IGNORED_TABLES in phase3c-classify.mjs).
const PRISMA_BUSINESS_TABLES = [
  'User', 'Team', 'Membership', 'Invite', 'Device', 'Job', 'Proxy', 'Automation',
  'AgentCommand', 'DeviceSession', 'TeamEmailSettings', 'AuditLog', 'DevicePairingToken',
]
const PRISMA_EXTRA_TABLES = ['DeviceApiKey']
const SUPABASE_LEGACY_TABLES = ['teams', 'team_members', 'team_invites', 'devices', 'jobs']

/** Redact any connection URL from an error/string — NEVER leak credentials. */
export function SAFE(e) {
  return String(e?.message ?? e).replace(/postgres(ql)?:\/\/[^\s]+/gi, '<redacted-url>')
}

/**
 * Build the pg.Client config from a connection URL. TLS is DERIVED from `sslmode` by
 * pg-connection-string (no hand-rolled TLS): strict by default; relaxed
 * (rejectUnauthorized:false) ONLY when the URL sets `sslmode=no-verify`.
 */
export function pgClientConfig(url) {
  return parse(url)
}

/** True only when TLS verification is EXPLICITLY relaxed (sslmode=no-verify). Used by the
 *  TLS tests to prove strict-by-default and relaxed-only-on-explicit-opt-in. */
export function isRelaxedTls(url) {
  const { ssl } = parse(url)
  return Boolean(ssl && typeof ssl === 'object' && ssl.rejectUnauthorized === false)
}

/** Count rows for the given table names inside ONE read-only, repeatable-read tx. */
async function countAll(url, tables) {
  const client = new pg.Client(pgClientConfig(url))
  await client.connect()
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const counts = {}
    for (const t of tables) {
      const exists = (await client.query('SELECT to_regclass($1) AS r', [`public."${t}"`])).rows[0].r
      counts[t] = exists ? (await client.query(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n : null
    }
    await client.query('COMMIT')
    return counts
  } finally {
    try { await client.end() } catch { /* noop */ }
  }
}

async function main() {
  const out = { generatedAt: new Date().toISOString(), prisma: null, supabase: null }

  if (process.env.PRISMA_RO_URL) {
    out.prisma = await countAll(process.env.PRISMA_RO_URL, [...PRISMA_BUSINESS_TABLES, ...PRISMA_EXTRA_TABLES])
  } else {
    out.prisma = { unavailable: 'PRISMA_RO_URL not set' }
    console.error('[inventory] PRISMA_RO_URL not set — Prisma side UNAVAILABLE (classifier will fail closed).')
  }

  if (process.env.SUPABASE_RO_URL) {
    out.supabase = await countAll(process.env.SUPABASE_RO_URL, SUPABASE_LEGACY_TABLES)
  } else {
    out.supabase = { unavailable: 'SUPABASE_RO_URL not set' }
    console.error('[inventory] SUPABASE_RO_URL not set — Supabase side UNAVAILABLE (classifier will fail closed).')
  }

  // Redacted by construction: only table => count is emitted, never URLs/rows/secrets.
  console.log(JSON.stringify(out, null, 2))
}

/** True only when executed directly (so importing for tests never connects). */
function isMain() {
  return import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.replace(/\\/g, '/').endsWith('prod-readiness-inventory.mjs')
}

if (isMain()) {
  main().catch((e) => { console.error(`[inventory] FATAL: ${SAFE(e)}`); process.exit(1) })
}
