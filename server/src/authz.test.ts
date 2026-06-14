import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildScope, toMember } from './auth/db'
import {
  can, canActOnPhone, canManageMember, isLastOwner, resolvePermission, scopePhones,
  type Member,
} from '../../src/lib/authorization/effective-access'

// ── buildScope ────────────────────────────────────────────────────────────────
test('buildScope defaults to the whole workspace', () => {
  const s = buildScope(undefined, undefined, undefined)
  assert.equal(s.type, 'workspace')
  assert.deepEqual(s.groups, [])
  assert.deepEqual(s.phones, [])
})

test('buildScope parses assigned_groups + string arrays, ignoring non-strings', () => {
  const s = buildScope('assigned_groups', ['A', 'B', 1, null], 'not-an-array')
  assert.equal(s.type, 'assigned_groups')
  assert.deepEqual(s.groups, ['A', 'B'])
  assert.deepEqual(s.phones, [])
})

test('buildScope falls back to workspace for an unknown scope type', () => {
  assert.equal(buildScope('bogus').type, 'workspace')
})

// ── toMember: suspension + scope ──────────────────────────────────────────────
test('toMember maps status=suspended to suspended=true', () => {
  assert.equal(toMember({ userId: 'u', role: 'admin', status: 'suspended' }).suspended, true)
  assert.equal(toMember({ userId: 'u', role: 'admin', status: 'active' }).suspended, false)
  assert.equal(toMember({ userId: 'u', role: 'admin' }).suspended, false)
})

test('toMember builds the real per-member scope from columns', () => {
  const m = toMember({ userId: 'u', role: 'operator', scopeType: 'assigned_groups', scopeGroups: ['Carolina'] })
  assert.equal(m.scope.type, 'assigned_groups')
  assert.deepEqual(m.scope.groups, ['Carolina'])
})

// ── suspension denies EVERYTHING, even for an owner ───────────────────────────
test('a suspended owner has zero effective permissions', () => {
  const owner = toMember({ userId: 'o', role: 'owner', status: 'suspended' })
  assert.equal(can(owner, 'phones.view'), false)
  assert.equal(can(owner, 'team.remove'), false)
  assert.equal(resolvePermission(owner, 'fleet.view').allowed, false)
})

// ── scope enforcement (the "scoped operator" attack the server must block) ────
const dev = (group: string, id = 'd1', name = 'D1') => ({ id, name, group })

test('a workspace-scoped operator can act on any device in the team', () => {
  const m = toMember({ userId: 'm', role: 'operator' })
  assert.equal(canActOnPhone(m, 'phones.control', dev('TeamB')), true)
})

test('an assigned_groups operator cannot control an out-of-scope device', () => {
  const m = toMember({ userId: 'm', role: 'operator', scopeType: 'assigned_groups', scopeGroups: ['TeamA'] })
  assert.equal(canActOnPhone(m, 'phones.control', dev('TeamA')), true)
  assert.equal(canActOnPhone(m, 'phones.control', dev('TeamB')), false)
})

test('scopePhones filters a device list down to the assigned groups', () => {
  const m = toMember({ userId: 'm', role: 'operator', scopeType: 'assigned_groups', scopeGroups: ['TeamA'] })
  const visible = scopePhones(m, [dev('TeamA', 'd1'), dev('TeamB', 'd2'), dev('TeamA', 'd3')]).map((d) => d.id)
  assert.deepEqual(visible.sort(), ['d1', 'd3'])
})

test('a member denied phones.view sees no devices regardless of scope', () => {
  const m: Member = {
    id: 'm', role: 'operator', overrides: { 'phones.view': 'deny' },
    scope: { type: 'assigned_groups', groups: ['TeamA'], phones: [] },
  }
  assert.deepEqual(scopePhones(m, [dev('TeamA')]), [])
})

// ── hierarchy protections used by the suspend / remove endpoints ──────────────
test('an admin cannot manage (or suspend) an owner', () => {
  assert.equal(canManageMember(toMember({ userId: 'a', role: 'admin' }), toMember({ userId: 'o', role: 'owner' })), false)
})

test('the last owner is protected; a co-owner is not', () => {
  const owner = toMember({ userId: 'o', role: 'owner' })
  assert.equal(isLastOwner(owner, [owner]), true)
  assert.equal(isLastOwner(owner, [owner, toMember({ userId: 'o2', role: 'owner' })]), false)
})
