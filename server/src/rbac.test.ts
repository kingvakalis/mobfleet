import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canAssignRole, canChangeRole, canRemoveMember, type Member } from '../../src/lib/authorization/effective-access'
import type { RoleId } from '../../src/lib/authorization/roles'

/**
 * Server-side reuse of the shared authorization engine. These assertions are
 * the anti-escalation / ownership contract enforced by the invite + member
 * routes (routes/team.ts).
 */
const m = (id: string, role: RoleId): Member => ({ id, role, overrides: {}, scope: { type: 'workspace', groups: [], phones: [] } })

test('an admin cannot invite/assign the owner role', () => {
  assert.equal(canAssignRole(m('a', 'admin'), 'owner'), false)
})

test('an admin can assign roles strictly below admin', () => {
  for (const r of ['manager', 'operator', 'viewer'] as RoleId[]) {
    assert.equal(canAssignRole(m('a', 'admin'), r), true)
  }
})

test('only an owner can assign the owner role', () => {
  assert.equal(canAssignRole(m('o', 'owner'), 'owner'), true)
})

test('a manager has no roles.assign → cannot invite/assign anyone', () => {
  assert.equal(canAssignRole(m('mg', 'manager'), 'viewer'), false)
})

test('the last owner cannot be removed or demoted', () => {
  const owner = m('o', 'owner')
  const all = [owner, m('a', 'admin')] // exactly one owner
  assert.equal(canRemoveMember(m('o2', 'owner'), owner, all).ok, false)
  assert.equal(canChangeRole(m('o2', 'owner'), owner, 'admin', all).ok, false)
})

test('a non-owner cannot manage an owner (even with two owners)', () => {
  const owner = m('o', 'owner')
  const all = [owner, m('o3', 'owner')] // two owners → not "last owner"
  assert.equal(canRemoveMember(m('a', 'admin'), owner, all).ok, false)
})

test('an owner can remove an admin', () => {
  const owner = m('o', 'owner')
  const admin = m('a', 'admin')
  assert.equal(canRemoveMember(owner, admin, [owner, admin]).ok, true)
})

test('no one can edit their own access (no self-escalation)', () => {
  const admin = m('a', 'admin')
  assert.equal(canChangeRole(admin, admin, 'owner', [admin, m('o', 'owner')]).ok, false)
})

test('a peer admin cannot remove or demote another admin (must strictly outrank)', () => {
  const a1 = m('a1', 'admin')
  const a2 = m('a2', 'admin')
  const all = [m('o', 'owner'), a1, a2]
  assert.equal(canRemoveMember(a1, a2, all).ok, false)
  assert.equal(canChangeRole(a1, a2, 'manager', all).ok, false)
})

test('an owner can still manage another owner when not the last owner', () => {
  const o1 = m('o1', 'owner')
  const o2 = m('o2', 'owner')
  assert.equal(canChangeRole(o1, o2, 'admin', [o1, o2]).ok, true)
})
