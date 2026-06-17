import { test } from 'node:test'
import assert from 'node:assert/strict'
// The classifier is a throwaway ops tool authored as ESM (.mjs); import the pure fn.
import { classifyPhase3c } from '../ops/phase3c-classify.mjs'

/**
 * Phase 3C cutover classifier — covers BOTH branches:
 *   (1) both snapshots empty of business records → SAFE_NOOP.
 *   (2) any business records present → BLOCK, naming exactly the offending tables/counts.
 * Pure: no I/O, no connection.
 */

// ── Branch 1: both empty → verified no-op ──────────────────────────────────────
test('both stores empty → SAFE_NOOP "verified no-op, safe to flip after gates"', () => {
  const r = classifyPhase3c({}, {})
  assert.equal(r.decision, 'SAFE_NOOP')
  assert.equal(r.safe, true)
  assert.equal(r.message, 'verified no-op, safe to flip after gates')
  assert.deepEqual(r.blocking, [])
})

test('all-zero counts (and ignored bookkeeping tables) → SAFE_NOOP', () => {
  const prisma = { User: 0, Team: 0, Membership: 0, MigrationRecord: 42, _prisma_migrations: 4 }
  const supabase = { teams: 0, team_members: 0, team_invites: 0 }
  const r = classifyPhase3c(prisma, supabase)
  assert.equal(r.decision, 'SAFE_NOOP')
  assert.equal(r.safe, true)
  assert.deepEqual(r.blocking, [])
})

// ── Branch 2: business records present → BLOCK ─────────────────────────────────
test('prisma has business records → BLOCK and lists exactly which tables/counts', () => {
  const r = classifyPhase3c({ User: 3, Team: 2, Membership: 0 }, {})
  assert.equal(r.decision, 'BLOCK')
  assert.equal(r.safe, false)
  assert.match(r.message, /BLOCK auth cutover; mapping required/)
  // Only NON-zero business tables are listed, sorted by table name.
  assert.deepEqual(r.blocking, [
    { store: 'prisma', table: 'Team', count: 2 },
    { store: 'prisma', table: 'User', count: 3 },
  ])
  assert.match(r.message, /prisma\.Team=2/)
  assert.match(r.message, /prisma\.User=3/)
})

test('supabase has business records → BLOCK names the supabase tables', () => {
  const r = classifyPhase3c({}, { teams: 5, team_members: 9, team_invites: 0, devices: 1 })
  assert.equal(r.decision, 'BLOCK')
  assert.equal(r.safe, false)
  assert.deepEqual(r.blocking, [
    { store: 'supabase', table: 'devices', count: 1 },
    { store: 'supabase', table: 'team_members', count: 9 },
    { store: 'supabase', table: 'teams', count: 5 },
  ])
})

test('records on BOTH sides → BLOCK lists prisma first then supabase', () => {
  const r = classifyPhase3c({ Team: 1 }, { teams: 1 })
  assert.equal(r.decision, 'BLOCK')
  assert.deepEqual(r.blocking, [
    { store: 'prisma', table: 'Team', count: 1 },
    { store: 'supabase', table: 'teams', count: 1 },
  ])
})

// ── Fail-safe behavior ─────────────────────────────────────────────────────────
test('an unknown populated table is treated as business (fail safe → BLOCK)', () => {
  const r = classifyPhase3c({ SomeNewTable: 7 }, {})
  assert.equal(r.decision, 'BLOCK')
  assert.deepEqual(r.blocking, [{ store: 'prisma', table: 'SomeNewTable', count: 7 }])
})

test('MigrationRecord / _prisma_migrations rows NEVER block on their own', () => {
  const r = classifyPhase3c({ MigrationRecord: 1000, _prisma_migrations: 4 }, {})
  assert.equal(r.decision, 'SAFE_NOOP')
  assert.equal(r.safe, true)
})

test('numeric strings are coerced; null/undefined snapshots are safe', () => {
  // Exercises the JS-level coercion the CLI relies on (numeric-string counts) and the
  // null/undefined snapshot guard. The classifier's declared signature accepts both.
  assert.equal(classifyPhase3c({ Team: '0' }, null).decision, 'SAFE_NOOP')
  assert.equal(classifyPhase3c({ Team: '3' }, undefined).decision, 'BLOCK')
})
