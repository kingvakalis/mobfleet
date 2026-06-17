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
// It NEVER connects anywhere. It consumes ONE unambiguous COMBINED snapshot — exactly
// the JSON emitted by ops/prod-readiness-inventory.mjs — via stdin or --input <file>:
//
//   node ops/prod-readiness-inventory.mjs > counts.json
//   node ops/phase3c-classify.mjs --input counts.json     # or:  < counts.json
//
// Combined shape: { "prisma": <side>, "supabase": <side> }, where each <side> is either a
// counts object { "<table>": number | null }  (null = table absent), OR an
// { "unavailable": "<reason>" } marker when that side was not inventoried.
//
// DECISION:
//   * BOTH sides inventoried AND empty of business records  -> SAFE_NOOP (exit 0).
//   * ANY business records present                          -> BLOCK    (exit 1).
//   * EITHER side missing / { unavailable } / not a counts object -> UNVERIFIED, FAIL
//     CLOSED (exit 1) — an un-inventoried side can NEVER be read as "empty / safe".
// Unknown populated tables are treated as business (fail safe). Bookkeeping tables in
// IGNORED_TABLES never block.
//
// The pure classifier (classifyPhase3c) + the fail-closed wrapper (classifyCombined) are
// unit-tested in server/src/phase3c.test.ts.

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

/**
 * A side is a VERIFIED counts object only when it is a non-null object whose every value
 * is a number (a count) or null (table absent). An { unavailable }/{ skipped }/{ error }
 * marker, a missing side, or any non-numeric value makes it UNVERIFIED. Pure.
 * @param {unknown} side
 * @returns {boolean}
 */
export function isVerifiedCounts(side) {
  if (!side || typeof side !== 'object' || Array.isArray(side)) return false
  const values = Object.values(side)
  if (values.length === 0) return true // an explicit empty counts object = nothing present
  return values.every((v) => v === null || typeof v === 'number')
}

/**
 * Fail-closed classifier over the COMBINED snapshot. If either side was not inventoried
 * (missing / { unavailable } / not a counts object) the result is UNVERIFIED and NOT safe
 * — an un-inventoried side can never green-light the cutover. Otherwise delegates to the
 * pure classifyPhase3c. Pure — no I/O.
 * @param {unknown} combined
 * @returns {{ decision: 'SAFE_NOOP'|'BLOCK', safe: boolean, message: string, blocking: {store:string,table:string,count:number}[], unverified?: string[] }}
 */
export function classifyCombined(combined) {
  if (!combined || typeof combined !== 'object') {
    return { decision: 'BLOCK', safe: false, message: 'UNVERIFIED: no/invalid snapshot (fail-closed — re-run the read-only inventory)', blocking: [], unverified: ['input'] }
  }
  const unverified = []
  if (!isVerifiedCounts(combined.prisma)) unverified.push('prisma')
  if (!isVerifiedCounts(combined.supabase)) unverified.push('supabase')
  if (unverified.length > 0) {
    return {
      decision: 'BLOCK',
      safe: false,
      message: `UNVERIFIED: ${unverified.join(', ')} not inventoried (fail-closed — provide both sides via the read-only inventory before deciding)`,
      blocking: [],
      unverified,
    }
  }
  return classifyPhase3c(combined.prisma, combined.supabase)
}

// ── CLI ─────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input') args.input = argv[++i]
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
  // ONE unambiguous interface: the combined { prisma, supabase } snapshot from the
  // inventory tool, via --input <file> or stdin.
  const combined = args.input ? readJson(args.input) : readStdin()
  if (!combined || typeof combined !== 'object') {
    console.error('phase3c: pipe the inventory snapshot { "prisma": {...}, "supabase": {...} } on stdin, or pass --input <file>')
    process.exit(2)
  }
  const result = classifyCombined(combined)
  console.log(JSON.stringify(result, null, 2))
  // Exit code is a gate signal: 0 = safe no-op; 1 = BLOCK or UNVERIFIED. NEVER auto-flips.
  process.exit(result.safe ? 0 : 1)
}
