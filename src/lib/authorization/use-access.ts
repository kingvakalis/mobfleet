import { useMemo } from 'react'
import { useTeam, toMember, type Employee } from '@/services/team'
import { useSession } from '@/state/session-store'
import { useFleet } from '@/hooks/use-fleet'
import type { Device } from '@/lib/provider/types'
import {
  can, resolvePermission, effectivePermissions,
  scopePhones, canActOnPhone,
  type Member, type PermissionSource,
} from './effective-access'
import { phoneInScope, groupInScope, type AccessScope } from './scopes'
import type { PermissionKey } from './permissions'

/** The Employee record + engine Member for the current acting user. */
export function useActingEmployee(): { employee: Employee; member: Member } {
  const employees = useTeam((s) => s.employees)
  const actingId = useSession((s) => s.actingId)
  return useMemo(() => {
    const employee =
      employees.find((e) => e.id === actingId) ??
      employees.find((e) => e.role === 'owner') ??
      employees[0]
    return { employee, member: toMember(employee) }
  }, [employees, actingId])
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

export { phoneInScope, groupInScope, canActOnPhone, scopePhones }
