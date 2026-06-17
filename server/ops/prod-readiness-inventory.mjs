// PRODUCTION READINESS INVENTORY — read-only row counts, DELIVER-ONLY.
//
// PURPOSE: before the Supabase->Prisma auth cutover (Phase 3C), an operator must know
// exactly how many business records exist on each side. This tool emits a REDACTED
// count snapshot in the shape the deterministic classifier (ops/phase3c-classify.mjs)
// consumes, so the cutover decision is made from evidence, not assumption.
//
// SAFETY (this is why it is "deliver-only"):
//   * It opens a SINGLE transaction per store as REPEATABLE READ, READ ONLY — the DB
//     itself rejects any write, and the snapshot is consistent (one MVCC view).
//   * It runs ONLY `SELECT count(*)` per table. No DDL, no DML, no schema reads beyond
//     a to_regclass existence probe (which is itself read-only).
//   * It prints NO connection URL, NO credentials, NO row contents — only table => count.
//   * The SUBAGENT does NOT run this against production. An operator runs it later with
//     DEDICATED READ-ONLY roles (see "REQUIRED ENV" below) on the real databases.
//
// REQUIRED ENV (all OPTIONAL; a store is skipped + reported "skipped" when unset):
//   PRISMA_RO_URL    postgresql URL for a READ-ONLY Prisma/Railway role. The role MUST
//                    have only CONNECT + USAGE on public + SELECT on the 13 business
//                    tables (no INSERT/UPDATE/DELETE, no CREATE). Counts the Prisma side.
//   SUPABASE_RO_URL  postgresql URL for a READ-ONLY Supabase role with SELECT on the 5
//                    legacy public tables. Counts the Supabase side. (auth.users is NOT
//                    read here — use ops/export-supabase-inventory-snapshot.sql for that,
//                    run by a Supabase admin, because the managed `auth` schema cannot be
//                    granted to a custom RO role.)
//
// Provision the read-only roles with ops/target-readonly-role.sql (Prisma/target) and
// ops/source-readonly-role.sql (Supabase/source) BEFORE running this.
//
// OUTPUT: JSON { generatedAt, prisma:{...counts}|{skipped}, supabase:{...counts}|{skipped} }.
// Pipe it straight into the classifier:
//   node ops/prod-readiness-inventory.mjs > counts.json
//   node ops/phase3c-classify.mjs < counts.json     # -> SAFE_NOOP (exit 0) or BLOCK (exit 1)
//
// Usage:  node ops/prod-readiness-inventory.mjs        (from server/)

import pg from 'pg'

// The 13 Prisma BUSINESS tables (every model that holds tenant/business data).
// NOTE: bookkeeping tables are intentionally EXCLUDED — MigrationRecord and Prisma's
// own _prisma_migrations are migration plumbing, not business records, and never gate
// the cutover (see IGNORED_TABLES in phase3c-classify.mjs). The 15 Prisma models minus
// those two bookkeeping tables == these 13.
const PRISMA_BUSINESS_TABLES = [
  'User', 'Team', 'Membership', 'Invite', 'Device', 'Job', 'Proxy', 'Automation',
  'AgentCommand', 'DeviceSession', 'TeamEmailSettings', 'AuditLog', 'DevicePairingToken',
]
// 14th business model DeviceApiKey is also data; the task scope is "13 business tables".
// Keep DeviceApiKey explicit + optional so the snapshot is complete without changing the
// gating set the classifier already enumerates.
const PRISMA_EXTRA_TABLES = ['DeviceApiKey']

// The 5 Supabase LEGACY business tables (public schema). auth.users is handled separately.
const SUPABASE_LEGACY_TABLES = ['teams', 'team_members', 'team_invites', 'devices', 'jobs']

const SAFE = (e) => String(e?.message ?? e).replace(/postgres(ql)?:\/\/[^\s]+/gi, '<redacted-url>')

/** Count rows for the given quoted table names inside ONE read-only, repeatable-read tx. */
async function countAll(url, tables) {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    // Consistent + write-proof: the DB rejects any write in this transaction.
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const counts = {}
    for (const t of tables) {
      // Existence probe first — a missing table is reported as null (not a crash), so a
      // partially-migrated target still yields a usable snapshot.
      const exists = (await client.query('SELECT to_regclass($1) AS r', [`public."${t}"`])).rows[0].r
      if (!exists) { counts[t] = null; continue }
      counts[t] = (await client.query(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n
    }
    await client.query('COMMIT')
    return counts
  } finally {
    try { await client.end() } catch { /* noop */ }
  }
}

async function main() {
  const out = { generatedAt: new Date().toISOString(), prisma: null, supabase: null }

  const prismaUrl = process.env.PRISMA_RO_URL
  if (prismaUrl) {
    out.prisma = await countAll(prismaUrl, [...PRISMA_BUSINESS_TABLES, ...PRISMA_EXTRA_TABLES])
  } else {
    out.prisma = { skipped: 'PRISMA_RO_URL not set' }
    console.error('[inventory] PRISMA_RO_URL not set — skipping the Prisma side.')
  }

  const supabaseUrl = process.env.SUPABASE_RO_URL
  if (supabaseUrl) {
    out.supabase = await countAll(supabaseUrl, SUPABASE_LEGACY_TABLES)
  } else {
    out.supabase = { skipped: 'SUPABASE_RO_URL not set' }
    console.error('[inventory] SUPABASE_RO_URL not set — skipping the Supabase side.')
  }

  // Redacted by construction: only table => count is emitted, never URLs/rows/secrets.
  console.log(JSON.stringify(out, null, 2))
}

main().catch((e) => { console.error(`[inventory] FATAL: ${SAFE(e)}`); process.exit(1) })
