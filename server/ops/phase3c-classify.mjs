// Phase 3C cutover classifier — DETERMINISTIC, OFFLINE decision support.
//
// Given two COUNT snapshots (one per data store) it decides whether the Supabase→
// Prisma auth cutover (VITE_AUTH_SOURCE=me) is a verified no-op or must be BLOCKED
// because real business records exist that would need a mapping/migration first.
//
//   * BOTH snapshots empty of business records → "verified no-op, safe to flip after gates".
//   * ANY business records present              → "BLOCK auth cutover; mapping required",
//                                                 listing exactly which tables/counts block it.
//
// It NEVER connects anywhere. Feed it JSON produced separately (by running the
// read-only inventory SQL in server/ops/*.sql and capturing the counts), e.g.:
//
//   node server/ops/phase3c-classify.mjs --prisma prisma-counts.json --supabase supabase-counts.json
//   cat both.json | node server/ops/phase3c-classify.mjs   # { "prisma": {...}, "supabase": {...} }
//
// Snapshot shape: a flat object of { "<table>": <count:number> }. Unknown keys are
// allowed and treated as business records (fail safe — an unexpected populated table
// blocks rather than being silently ignored).
//
// The pure classifier (classifyPhase3c) is unit-tested in server/src/phase3c.test.ts.

import { readFileSync } from 'node:fs'

/**
 * Tables that hold genuine BUSINESS records. A non-zero count in any of these on
 * either side means data exists that the auth cutover would orphan/duplicate
 * unless it is mapped/migrated first. Bookkeeping-only tables are listed in
 * IGNORED_TABLES and never block.
 */
export const PRISMA_BUSINESS_TABLES = [
  'User', 'Team', 'Membership', 'Invite', 'Device', 'Job', 'Proxy', 'Automation',
  'AgentCommand', 'DeviceSession', 'TeamEmailSettings', 'AuditLog',
  'DevicePairingToken', 'DeviceApiKey',
]
export const SUPABASE_BUSINESS_TABLES = [
  'teams', 'team_members', 'team_invites', 'devices', 'jobs',
]

/** Pure bookkeeping — presence of rows here never blocks the cutover. */
export const IGNORED_TABLES = new Set(['MigrationRecord', '_prisma_migrations'])

/**
 * Reduce a raw count snapshot to the non-zero BUSINESS tables. Any key not in the
 * ignore set counts as business (fail safe). Non-numeric/negative counts are
 * coerced and treated as present when > 0.
 * @param {Record<string, unknown>} snapshot
 * @returns {{ table: string, count: number }[]} sorted by table name
 */
function nonZeroBusiness(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return []
  const out = []
  for (const [table, raw] of Object.entries(snapshot)) {
    if (IGNORED_TABLES.has(table)) continue
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (Number.isFinite(n) && n > 0) out.push({ table, count: n })
  }
  return out.sort((a, b) => a.table.localeCompare(b.table))
}

/**
 * Deterministic classifier. Pure — no I/O.
 * @param {Record<string, unknown>} prismaCounts
 * @param {Record<string, unknown>} supabaseCounts
 * @returns {{
 *   decision: 'SAFE_NOOP' | 'BLOCK',
 *   safe: boolean,
 *   message: string,
 *   blocking: { store: 'prisma' | 'supabase', table: string, count: number }[],
 * }}
 */
export function classifyPhase3c(prismaCounts, supabaseCounts) {
  const prismaHits = nonZeroBusiness(prismaCounts).map((h) => ({ store: 'prisma', ...h }))
  const supabaseHits = nonZeroBusiness(supabaseCounts).map((h) => ({ store: 'supabase', ...h }))
  const blocking = [...prismaHits, ...supabaseHits]

  if (blocking.length === 0) {
    return {
      decision: 'SAFE_NOOP',
      safe: true,
      message: 'verified no-op, safe to flip after gates',
      blocking: [],
    }
  }
  const detail = blocking.map((b) => `${b.store}.${b.table}=${b.count}`).join(', ')
  return {
    decision: 'BLOCK',
    safe: false,
    message: `BLOCK auth cutover; mapping required (business records present: ${detail})`,
    blocking,
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--prisma') args.prisma = argv[++i]
    else if (a === '--supabase') args.supabase = argv[++i]
  }
  return args
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    console.error(`phase3c: cannot read JSON from ${path}: ${e instanceof Error ? e.message : e}`)
    process.exit(2)
  }
}

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    return null
  }
}

function isMain() {
  // True when executed directly (not imported).
  return import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.replace(/\\/g, '/').endsWith('phase3c-classify.mjs')
}

if (isMain()) {
  const args = parseArgs(process.argv.slice(2))
  let prismaCounts = {}
  let supabaseCounts = {}
  if (args.prisma || args.supabase) {
    if (args.prisma) prismaCounts = readJson(args.prisma)
    if (args.supabase) supabaseCounts = readJson(args.supabase)
  } else {
    const combined = readStdin()
    if (!combined || typeof combined !== 'object') {
      console.error('phase3c: provide --prisma <file> --supabase <file>, or pipe { "prisma": {...}, "supabase": {...} } on stdin')
      process.exit(2)
    }
    prismaCounts = combined.prisma ?? {}
    supabaseCounts = combined.supabase ?? {}
  }

  const result = classifyPhase3c(prismaCounts, supabaseCounts)
  console.log(JSON.stringify(result, null, 2))
  // Exit code is a gate signal: 0 = safe no-op, 1 = BLOCK. NEVER auto-flips anything.
  process.exit(result.safe ? 0 : 1)
}
