import { useMemo } from 'react'
import { useTeam, toMember, type Employee } from '@/services/team'
import { useSession } from '@/state/session-store'
import { useFleet } from '@/hooks/use-fleet'
import { useAuth } from '@/contexts/AuthContext'
import { useTeamContext } from '@/contexts/TeamContext'
import { memberToRoster } from '@/services/team-members'
import { computeStats, type FleetStats } from '@/lib/provider/stats'
import type { Device } from '@/lib/provider/types'
import {
  can, resolvePermission, effectivePermissions,
  scopePhones, canActOnPhone,
  type Member, type PermissionSource,
} from './effective-access'
import { phoneInScope, groupInScope, type AccessScope } from './scopes'
import type { PermissionKey } from './permissions'

/** Fully-denied placeholder while the real membership loads (or is absent), so no
 *  permission ever leaks before the signed-in user's role is known. */
const DENIED_EMPLOYEE: Employee = {
  id: '__none__', name: 'Member', email: '', role: 'viewer', groups: [], phones: [],
  scopeType: 'self', overrides: {}, createdAt: 0, suspended: true,
  shiftStatus: 'offline', shiftStart: null, breakStart: null, breakMinutesToday: 0,
  currentPhone: null, currentSessionStart: null, lastActivity: 0, history: [],
}

/**
 * The Employee record + engine Member for the current acting user.
 *
 * With real auth (enabled), this resolves from the SIGNED-IN user's actual
 * team_members row (role, status, scope, overrides) — the session is the identity,
 * not the dev "acting as" switcher. In the standalone demo build (no Supabase),
 * it falls back to the mock roster + the acting-as selector so roles stay
 * explorable without a login.
 */
export function useActingEmployee(): { employee: Employee; member: Member } {
  const { enabled } = useAuth()
  const { currentMember } = useTeamContext()
  const employees = useTeam((s) => s.employees)
  const actingId = useSession((s) => s.actingId)
  return useMemo(() => {
    if (enabled) {
      const employee = currentMember ? memberToRoster(currentMember) : DENIED_EMPLOYEE
      return { employee, member: toMember(employee) }
    }
    const employee =
      employees.find((e) => e.id === actingId) ??
      employees.find((e) => e.role === 'owner') ??
      employees[0]
    return { employee, member: toMember(employee) }
  }, [enabled, currentMember, employees, actingId])
}

export function useActingMember(): Member {
  return useActingEmployee().member
}

/** Boolean permission check for the acting user. */
export function usePermission(key: PermissionKey): boolean {
  const member = useActingMember()
  return useMemo(() => can(member, key), [member, key])
}

export function useAnyPermission(keys: PermissionKey[]): boolean {
  const eff = useEffectivePermissions()
  return keys.some((k) => eff.has(k))
}

export function useAllPermissions(keys: PermissionKey[]): boolean {
  const eff = useEffectivePermissions()
  return keys.every((k) => eff.has(k))
}

export function usePermissionSource(key: PermissionKey): PermissionSource {
  const member = useActingMember()
  return useMemo(() => resolvePermission(member, key).source, [member, key])
}

export function useEffectivePermissions(): Set<PermissionKey> {
  const member = useActingMember()
  return useMemo(() => effectivePermissions(member), [member])
}

export function useScope(): AccessScope {
  return useActingMember().scope
}

/** Scoped check: permission held AND the resource is within scope. */
export function usePhoneAccess(key: PermissionKey, phone: { group?: string; name?: string; id?: string }): boolean {
  const member = useActingMember()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => canActOnPhone(member, key, phone), [member, key, phone.group, phone.name, phone.id])
}

/** The live fleet's devices, filtered to the acting member's permission + scope.
 *  SECURITY: this is the selector boundary — unauthorized devices never reach
 *  the components. The same predicate must run in the server query. */
export function useScopedDevices(): Device[] {
  const member = useActingMember()
  const { devices } = useFleet()
  return useMemo(() => scopePhones(member, devices), [member, devices])
}

/** Header/HUD counters computed over the acting member's SCOPED devices, so a
 *  restricted operator's fleet totals match the devices they can actually see
 *  (queue is a fleet-level job metric and stays global). */
export function useScopedFleetStats(): FleetStats {
  const member = useActingMember()
  const snapshot = useFleet()
  return useMemo(
    () => computeStats({ ...snapshot, devices: scopePhones(member, snapshot.devices) }),
    [member, snapshot],
  )
}

export { phoneInScope, groupInScope, canActOnPhone, scopePhones }
