import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { loadSourceSnapshot, SUPPORTED_SNAPSHOT_VERSION } from './snapshot'

// Pure tests (no DB) for the offline snapshot loader: a valid snapshot loads with a deterministic
// SHA-256; every malformed snapshot fails closed (throws).

const files: string[] = []
function writeSnap(content: unknown): string {
  const p = join(tmpdir(), `mf-snap-${randomUUID()}.json`)
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content))
  files.push(p)
  return p
}
after(() => {
  for (const f of files) try { rmSync(f, { force: true }) } catch { /* ignore */ }
})

function valid(): Record<string, unknown> {
  return {
    snapshotVersion: SUPPORTED_SNAPSHOT_VERSION,
    source: 'supabase',
    generatedAt: '2026-06-16T00:00:00Z',
    authUsers: [{ id: 'u1', email: 'a@x.com', emailConfirmedAt: '2024-01-01T00:00:00Z', fullName: 'A', createdAt: '2024-01-01T00:00:00Z' }],
    teams: [{ id: 't1', name: 'Acme', ownerUserId: 'u1', createdAt: '2024-01-01T00:00:00Z' }],
    members: [{ id: 'm1', teamId: 't1', userId: 'u1', role: 'owner', status: 'active', email: 'a@x.com', name: 'A', invitedBy: null, scopeType: 'workspace', scopeGroups: [], scopePhones: [], overrides: {}, joinedAt: '2024-01-01T00:00:00Z' }],
    invites: [{ id: 'i1', teamId: 't1', email: 'new@x.com', role: 'operator', token: 'tok_abc', status: 'pending', invitedBy: null, createdAt: '2024-01-01T00:00:00Z', expiresAt: '2024-02-01T00:00:00Z', acceptedAt: null }],
  }
}

test('valid snapshot loads: counts, mode, nullable proofs, deterministic sha256', () => {
  const p = writeSnap(valid())
  const s = loadSourceSnapshot(p)
  assert.equal(s.mode, 'offline_snapshot')
  assert.equal(s.proof, null)
  assert.equal(s.roleProof, null)
  assert.equal(s.authUsers.length, 1)
  assert.equal(s.teams.length, 1)
  assert.equal(s.members.length, 1)
  assert.equal(s.invites.length, 1)
  assert.equal(s.snapshotMeta?.version, SUPPORTED_SNAPSHOT_VERSION)
  assert.equal(s.snapshotMeta?.generatedAt, '2026-06-16T00:00:00Z')
  assert.match(s.snapshotMeta?.sha256 ?? '', /^[0-9a-f]{64}$/)
  // deterministic: same bytes -> same hash
  assert.equal(loadSourceSnapshot(p).snapshotMeta?.sha256, s.snapshotMeta?.sha256)
})

test('fail-closed: unsupported / unknown version', () => {
  assert.throws(() => loadSourceSnapshot(writeSnap({ ...valid(), snapshotVersion: 999 })), /unsupported snapshotVersion/)
  assert.throws(() => loadSourceSnapshot(writeSnap({ ...valid(), snapshotVersion: undefined })), /unsupported snapshotVersion/)
})
test('fail-closed: invalid JSON file', () => {
  assert.throws(() => loadSourceSnapshot(writeSnap('{ not valid json')), /invalid JSON/)
})
test('fail-closed: root not an object / missing datasets', () => {
  assert.throws(() => loadSourceSnapshot(writeSnap([])), /root must be a JSON object/)
  assert.throws(() => loadSourceSnapshot(writeSnap({ snapshotVersion: 1, generatedAt: '2026-06-16T00:00:00Z', teams: [], members: [], invites: [] })), /authUsers must be a JSON array/)
})
test('fail-closed: missing required field', () => {
  assert.throws(() => loadSourceSnapshot(writeSnap({ ...valid(), teams: [{ id: 't1', ownerUserId: 'u1', createdAt: '2024-01-01T00:00:00Z' }] })), /teams\[0\]\.name/)
})
test('fail-closed: wrong field type', () => {
  assert.throws(() => loadSourceSnapshot(writeSnap({ ...valid(), authUsers: [{ id: 123, email: 'a@x.com', emailConfirmedAt: null, fullName: null, createdAt: null }] })), /authUsers\[0\]\.id/)
})
test('fail-closed: duplicate ids', () => {
  const o = valid()
  o.teams = [{ id: 't1', name: 'A', ownerUserId: 'u1', createdAt: null }, { id: 't1', name: 'B', ownerUserId: 'u1', createdAt: null }]
  assert.throws(() => loadSourceSnapshot(writeSnap(o)), /duplicate teams id: t1/)
})
test('fail-closed: malformed timestamp', () => {
  assert.throws(() => loadSourceSnapshot(writeSnap({ ...valid(), authUsers: [{ id: 'u1', email: null, emailConfirmedAt: null, fullName: null, createdAt: 'not-a-date' }] })), /malformed timestamp/)
})
test('fail-closed: malformed JSON value (scopeGroups not array, overrides not object)', () => {
  const bad = (over: Record<string, unknown>): Record<string, unknown> => ({
    ...valid(),
    members: [{ id: 'm1', teamId: 't1', userId: 'u1', role: 'owner', status: 'active', email: null, name: null, invitedBy: null, scopeType: 'workspace', scopeGroups: [], scopePhones: [], overrides: {}, joinedAt: null, ...over }],
  })
  assert.throws(() => loadSourceSnapshot(writeSnap(bad({ scopeGroups: 'oops' }))), /scopeGroups must be a JSON array or null/)
  assert.throws(() => loadSourceSnapshot(writeSnap(bad({ overrides: [1, 2] }))), /overrides must be a JSON object or null/)
})
test('fail-closed: missing file', () => {
  assert.throws(() => loadSourceSnapshot(join(tmpdir(), `does-not-exist-${randomUUID()}.json`)), /cannot read snapshot file/)
})
