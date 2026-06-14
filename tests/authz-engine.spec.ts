import { test, expect } from 'playwright/test'
import {
  resolvePermission, effectivePermissions, can,
  assignableRoles, canAssignRole, canGrantPermission,
  canManageMember, isLastOwner, canRemoveMember, canChangeRole,
  scopePhones, canActOnPhone, type Member,
} from '../src/lib/authorization/effective-access'
import { phoneInScope } from '../src/lib/authorization/scopes'

/**
 * Pure-function tests for the effective-access engine — the security core.
 * No browser, no server: the same functions run on the (future) backend, so
 * these assertions are the contract for server-side enforcement too.
 */

const member = (over: Partial<Member> & { role: Member['role'] }): Member => ({
  id: over.id ?? `m-${over.role}`,
  role: over.role,
  suspended: over.suspended,
  overrides: over.overrides ?? {},
  scope: over.scope ?? { type: 'workspace', groups: [], phones: [] },
})

// ─── Permission resolution ────────────────────────────────────────────────────

test('a role-granted permission resolves via the role', () => {
  const op = member({ role: 'operator' })
  expect(can(op, 'phones.control')).toBe(true)   // operators control phones
  expect(can(op, 'phones.reboot')).toBe(false)   // …but cannot reboot
})

test('explicit Deny always wins over a role grant', () => {
  const m = member({ role: 'admin', overrides: { 'phones.control': 'deny' } })
  expect(can(m, 'phones.control')).toBe(false)
  expect(resolvePermission(m, 'phones.control').source).toBe('denied')
})

test('an Allow override grants a permission absent from the role', () => {
  const m = member({ role: 'viewer', overrides: { 'phones.control': 'allow' } })
  expect(can(m, 'phones.control')).toBe(true)
  expect(resolvePermission(m, 'phones.control').source).toBe('granted')
})

test('a suspended member has no effective permissions', () => {
  const m = member({ role: 'owner', suspended: true })
  expect(can(m, 'fleet.view')).toBe(false)
  expect(effectivePermissions(m).size).toBe(0)
})

test('Owner holds every permission; Admin lacks ownership and billing', () => {
  const owner = member({ role: 'owner' })
  const admin = member({ role: 'admin' })
  expect(can(owner, 'workspace.transfer_ownership')).toBe(true)
  expect(can(admin, 'workspace.transfer_ownership')).toBe(false)
  expect(can(admin, 'workspace.delete')).toBe(false)
  expect(can(admin, 'billing.manage')).toBe(false)
  expect(can(admin, 'phones.control')).toBe(true)
})

// ─── Anti-escalation ──────────────────────────────────────────────────────────

test('assignableRoles respects authority rank and the owner-grants-owner rule', () => {
  expect(assignableRoles(member({ role: 'owner' }))).toContain('owner')
  expect(assignableRoles(member({ role: 'admin' }))).not.toContain('owner')
  expect(assignableRoles(member({ role: 'admin' }))).toContain('manager')
  // Managers lack roles.assign entirely.
  expect(assignableRoles(member({ role: 'manager' }))).toEqual([])
})

test('an actor cannot grant a permission they do not hold', () => {
  const admin = member({ role: 'admin' })
  expect(canGrantPermission(admin, 'phones.control')).toBe(true)
  expect(canGrantPermission(admin, 'workspace.transfer_ownership')).toBe(false)
})

test('an actor cannot assign a role at or above their own authority', () => {
  const admin = member({ role: 'admin' })
  const mgr = member({ role: 'manager', id: 'm2' })
  expect(canAssignRole(admin, 'admin')).toBe(false)            // equal rank → no
  expect(canChangeRole(admin, mgr, 'admin', [admin, mgr]).ok).toBe(false)
  expect(canChangeRole(admin, mgr, 'operator', [admin, mgr]).ok).toBe(true)
})

// ─── Owner invariants ─────────────────────────────────────────────────────────

test('the last Owner cannot be removed or demoted — even by themselves', () => {
  const owner = member({ role: 'owner', id: 'o1' })
  const all = [owner, member({ role: 'admin', id: 'a1' })]
  expect(isLastOwner(owner, all)).toBe(true)
  expect(canRemoveMember(owner, owner, all).ok).toBe(false)
  expect(canChangeRole(owner, owner, 'admin', all).ok).toBe(false)
})

test('with two Owners, one may be demoted', () => {
  const o1 = member({ role: 'owner', id: 'o1' })
  const o2 = member({ role: 'owner', id: 'o2' })
  const all = [o1, o2]
  expect(isLastOwner(o1, all)).toBe(false)
  expect(canChangeRole(o1, o2, 'admin', all).ok).toBe(true)
})

test('an Admin cannot manage or remove an Owner', () => {
  const admin = member({ role: 'admin', id: 'a1' })
  const owner = member({ role: 'owner', id: 'o1' })
  const all = [owner, admin, member({ role: 'owner', id: 'o2' })] // not last owner
  expect(canManageMember(admin, owner)).toBe(false)
  expect(canRemoveMember(admin, owner, all).ok).toBe(false)
})

test('no member can edit their own access (no self-escalation)', () => {
  const admin = member({ role: 'admin', id: 'a1' })
  expect(canManageMember(admin, admin)).toBe(false)
})

// ─── Resource scope ───────────────────────────────────────────────────────────

test('phoneInScope honours each scope type', () => {
  expect(phoneInScope({ type: 'workspace', groups: [], phones: [] }, { name: 'X', group: 'G' })).toBe(true)
  expect(phoneInScope({ type: 'assigned_groups', groups: ['G'], phones: [] }, { group: 'G' })).toBe(true)
  expect(phoneInScope({ type: 'assigned_groups', groups: ['G'], phones: [] }, { group: 'H' })).toBe(false)
  expect(phoneInScope({ type: 'assigned_phones', groups: [], phones: ['P1'] }, { name: 'P1' })).toBe(true)
  expect(phoneInScope({ type: 'assigned_phones', groups: [], phones: ['P1'] }, { name: 'P2' })).toBe(false)
  expect(phoneInScope({ type: 'self', groups: [], phones: [] }, { name: 'P1' })).toBe(false)
})

test('scopePhones filters to scope; workspace and view_all bypass it', () => {
  const phones = [{ id: '1', name: 'P1', group: 'G' }, { id: '2', name: 'P2', group: 'H' }]
  const scoped = member({ role: 'operator', scope: { type: 'assigned_phones', groups: [], phones: ['P1'] } })
  expect(scopePhones(scoped, phones).map((p) => p.name)).toEqual(['P1'])

  const ws = member({ role: 'operator', scope: { type: 'workspace', groups: [], phones: [] } })
  expect(scopePhones(ws, phones)).toHaveLength(2)

  const viewAll = member({
    role: 'operator',
    scope: { type: 'assigned_phones', groups: [], phones: ['P1'] },
    overrides: { 'phones.view_all': 'allow' },
  })
  expect(scopePhones(viewAll, phones)).toHaveLength(2)
})

test('canActOnPhone requires both the permission AND the phone being in scope', () => {
  const op = member({ role: 'operator', scope: { type: 'assigned_phones', groups: [], phones: ['P1'] } })
  expect(canActOnPhone(op, 'phones.control', { name: 'P1' })).toBe(true)
  expect(canActOnPhone(op, 'phones.control', { name: 'P2' })).toBe(false) // out of scope
  expect(canActOnPhone(op, 'phones.reboot', { name: 'P1' })).toBe(false)  // lacks the permission
})
