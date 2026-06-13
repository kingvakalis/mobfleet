/**
 * Effective-access engine — the heart of MobFleet authorization.
 *
 * effectivePermissions = rolePermissions ∪ userGrants − userDenials
 * Explicit Deny always wins over Allow and over role-derived permission.
 * Suspended members get nothing.
 *
 * Plus anti-escalation + ownership invariants used by the Team access UI and
 * (when wired) the server guards. Pure functions, no React — portable to the
 * backend verbatim.
 */

import { ALL_PERMISSION_KEYS, type PermissionKey } from './permissions'
import { ROLE_TEMPLATES, roleRank, type RoleId } from './roles'
import { phoneInScope, groupInScope, type AccessScope } from './scopes'

export type OverrideEffect = 'allow' | 'deny'

/** The authorization-relevant shape of a workspace member. Maps onto the
 *  Employee record in services/team.ts. */
export interface Member {
  id: string
  role: RoleId
  suspended?: boolean
  /** Per-permission overrides layered on top of the role. */
  overrides: Partial<Record<PermissionKey, OverrideEffect>>
  scope: AccessScope
}

export type PermissionSource = 'role' | 'granted' | 'denied' | 'none'

/** Resolve a single permission to its effective state + provenance. */
export function resolvePermission(member: Member, key: PermissionKey): { allowed: boolean; source: PermissionSource } {
  if (member.suspended) return { allowed: false, source: 'denied' }
  const override = member.overrides[key]
  if (override === 'deny') return { allowed: false, source: 'denied' }
  const fromRole = ROLE_TEMPLATES[member.role]?.permissions.includes(key) ?? false
  if (override === 'allow') return { allowed: true, source: fromRole ? 'role' : 'granted' }
  return fromRole ? { allowed: true, source: 'role' } : { allowed: false, source: 'none' }
}

/** The complete effective permission set for a member. */
export function effectivePermissions(member: Member): Set<PermissionKey> {
  const set = new Set<PermissionKey>()
  if (member.suspended) return set
  for (const key of ALL_PERMISSION_KEYS) {
    if (resolvePermission(member, key).allowed) set.add(key)
  }
  return set
}

export function can(member: Member, key: PermissionKey): boolean {
  return resolvePermission(member, key).allowed
}

export function canAny(member: Member, keys: PermissionKey[]): boolean {
  return keys.some((k) => can(member, k))
}

export function canAll(member: Member, keys: PermissionKey[]): boolean {
  return keys.every((k) => can(member, k))
}

// ─── Scope-filtered data access ───────────────────────────────────────────────
// SECURITY: the same predicates belong in the server query. Never fetch the
// whole workspace and merely hide unauthorized rows in the browser.

/** Filter a phone-like list to those the member may see (permission + scope). */
export function scopePhones<T extends { group?: string; name?: string; id?: string }>(member: Member, phones: T[]): T[] {
  if (member.suspended || !can(member, 'phones.view')) return []
  if (member.scope.type === 'workspace' || can(member, 'phones.view_all')) return phones
  return phones.filter((p) => phoneInScope(member.scope, p))
}

/** May the member act on a specific phone? Permission held AND phone in scope. */
export function canActOnPhone(member: Member, key: PermissionKey, phone: { group?: string; name?: string; id?: string }): boolean {
  if (!can(member, key)) return false
  if (member.scope.type === 'workspace' || can(member, 'phones.view_all')) return true
  return phoneInScope(member.scope, phone)
}

/** Filter a group-name list to those within the member's scope. */
export function scopeGroups(member: Member, groups: string[]): string[] {
  if (member.suspended || !can(member, 'groups.view')) return []
  if (member.scope.type === 'workspace') return groups
  return groups.filter((g) => groupInScope(member.scope, g))
}

// ─── Anti-escalation & ownership invariants ──────────────────────────────────

/**
 * Permissions an actor is allowed to GRANT to others = the permissions the
 * actor themselves effectively holds. You can never grant what you lack.
 */
export function grantablePermissions(actor: Member): Set<PermissionKey> {
  return effectivePermissions(actor)
}

export function canGrantPermission(actor: Member, key: PermissionKey): boolean {
  return can(actor, key)
}

/**
 * Roles an actor may assign to others. Requires roles.assign and only roles
 * strictly below the actor's own authority rank. Only an Owner may grant Owner.
 */
export function assignableRoles(actor: Member): RoleId[] {
  if (!can(actor, 'roles.assign')) return []
  const actorRank = roleRank(actor.role)
  return (Object.keys(ROLE_TEMPLATES) as RoleId[]).filter((rid) => {
    if (rid === 'owner') return actor.role === 'owner' // only an owner grants owner
    return roleRank(rid) < actorRank
  })
}

export function canAssignRole(actor: Member, role: RoleId): boolean {
  return assignableRoles(actor).includes(role)
}

/**
 * May `actor` modify `target`'s access at all? Owners may modify anyone;
 * non-owners may never modify an Owner; otherwise the actor must outrank the
 * target and hold team.edit. Acting on yourself is allowed for read but
 * mutations to your own critical access are blocked elsewhere.
 */
export function canManageMember(actor: Member, target: Member): boolean {
  if (actor.id === target.id) return false // no self-edit of access (prevents self-escalation)
  if (target.role === 'owner' && actor.role !== 'owner') return false
  if (!can(actor, 'team.edit')) return false
  return roleRank(actor.role) >= roleRank(target.role) || actor.role === 'owner'
}

/** Last-Owner protection: an owner cannot be demoted/removed/suspended if they
 *  are the only owner left. */
export function isLastOwner(target: Member, allMembers: Member[]): boolean {
  if (target.role !== 'owner') return false
  const owners = allMembers.filter((m) => m.role === 'owner' && !m.suspended)
  return owners.length <= 1 && owners.some((o) => o.id === target.id)
}

export function canRemoveMember(actor: Member, target: Member, allMembers: Member[]): { ok: boolean; reason?: string } {
  if (isLastOwner(target, allMembers)) return { ok: false, reason: 'The last Owner cannot be removed.' }
  if (!canManageMember(actor, target)) return { ok: false, reason: 'You cannot manage this member.' }
  if (!can(actor, 'team.remove')) return { ok: false, reason: 'You lack permission to remove employees.' }
  return { ok: true }
}

export function canChangeRole(actor: Member, target: Member, nextRole: RoleId, allMembers: Member[]): { ok: boolean; reason?: string } {
  if (target.role === 'owner' && nextRole !== 'owner' && isLastOwner(target, allMembers)) {
    return { ok: false, reason: 'The last Owner cannot be demoted.' }
  }
  if (!canManageMember(actor, target)) return { ok: false, reason: 'You cannot manage this member.' }
  if (!canAssignRole(actor, nextRole)) return { ok: false, reason: 'You cannot assign a role at or above your authority.' }
  return { ok: true }
}
