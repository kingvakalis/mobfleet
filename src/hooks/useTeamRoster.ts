import { useCallback, useMemo } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useTeamContext } from '@/contexts/TeamContext'
import { useToastStore } from '@/state/toast-store'
import { useShiftOverlay } from '@/state/shift-overlay'
import { useTeam as useMockTeam, type Employee } from '@/services/team'
import {
  memberToRoster, inviteToRoster, inviteUrl,
  createInvite as svcCreateInvite, sendInviteEmail, revokeInvite as svcRevokeInvite,
  updateMemberRole, setMemberScope, setMemberOverrides, setMemberStatus, removeMember,
  type RosterMember,
} from '@/services/team-members'
import type { RoleId } from '@/lib/authorization/roles'
import type { PermissionKey } from '@/lib/authorization/permissions'
import type { OverrideEffect } from '@/lib/authorization/effective-access'

type EmployeePatch = Partial<Pick<Employee, 'role' | 'scopeType' | 'groups' | 'phones' | 'name' | 'email'>>

export interface AddResult {
  /** True when an invitation was created (Supabase mode); false = local add (mock). */
  invited: boolean
  /** Shareable accept link (invited === true). */
  url?: string
  /** Whether the invite email was dispatched (best-effort). */
  emailed?: boolean
}

export interface RosterApi {
  enabled: boolean
  loading: boolean
  /** Initial-load error (Supabase mode); null in the mock build. */
  error: string | null
  employees: RosterMember[]
  refresh: () => void | Promise<void>
  updateEmployee: (m: RosterMember, patch: EmployeePatch) => void
  setOverride: (m: RosterMember, key: PermissionKey, effect: OverrideEffect | null) => void
  setSuspended: (m: RosterMember, suspended: boolean) => void
  removeEmployee: (m: RosterMember) => void | Promise<void>
  /** Invite (Supabase) or add locally (mock), depending on `enabled`. */
  addEmployee: (input: { name: string; email: string; role: RoleId }) => Promise<AddResult>
  startShift: (id: string) => void
  endShift: (id: string) => void
  toggleBreak: (id: string) => void
}

const toast = (msg: string, level: 'success' | 'error' | 'info' = 'info') =>
  useToastStore.getState().addToast(msg, level)

/**
 * Single source of truth for the Team roster, switching on whether Supabase auth
 * is configured:
 *  • enabled  → real team_members + team_invites (RLS), member mutations + invite
 *               lifecycle via the team-members service; shift actions drive the
 *               ephemeral local overlay (no shift backend yet).
 *  • disabled → the existing mock zustand store (standalone demo build), unchanged.
 */
export function useRoster(): RosterApi {
  const { enabled, user } = useAuth()
  const teamCtx = useTeamContext()
  const overlay = useShiftOverlay((s) => s.overlay)
  const ovStart = useShiftOverlay((s) => s.startShift)
  const ovEnd = useShiftOverlay((s) => s.endShift)
  const ovBreak = useShiftOverlay((s) => s.toggleBreak)

  // Mock store (only meaningfully used when !enabled).
  const mockEmployees = useMockTeam((s) => s.employees)
  const mockAdd = useMockTeam((s) => s.addEmployee)
  const mockUpdate = useMockTeam((s) => s.updateEmployee)
  const mockSetOverride = useMockTeam((s) => s.setOverride)
  const mockSetSuspended = useMockTeam((s) => s.setSuspended)
  const mockRemove = useMockTeam((s) => s.removeEmployee)
  const mockStart = useMockTeam((s) => s.startShift)
  const mockEnd = useMockTeam((s) => s.endShift)
  const mockBreak = useMockTeam((s) => s.toggleBreak)

  const teamId = teamCtx.team?.id ?? null

  const employees = useMemo<RosterMember[]>(() => {
    if (!enabled) {
      return mockEmployees.map((e) => ({ ...e, status: e.suspended ? 'suspended' : 'active', userId: e.id }))
    }
    const live = teamCtx.members.map((row) => {
      const base = memberToRoster(row)
      const ov = overlay[base.id]
      return ov ? { ...base, ...ov } : base
    })
    const pending = teamCtx.invites.map(inviteToRoster)
    return [...live, ...pending]
  }, [enabled, mockEmployees, teamCtx.members, teamCtx.invites, overlay])

  const run = useCallback(
    (p: Promise<unknown>, errMsg: string) => {
      p.then(() => teamCtx.refresh()).catch((e) => {
        toast(`${errMsg}: ${e instanceof Error ? e.message : 'failed'}`, 'error')
      })
    },
    [teamCtx],
  )

  const updateEmployee = useCallback(
    (m: RosterMember, patch: EmployeePatch) => {
      if (!enabled) { mockUpdate(m.id, patch); return }
      if (!teamId || !m.userId) return // invited rows aren't editable this way
      if (patch.role) run(updateMemberRole(teamId, m.userId, patch.role), 'Could not change role')
      if (patch.scopeType !== undefined || patch.groups !== undefined || patch.phones !== undefined) {
        run(
          setMemberScope(teamId, m.userId, {
            scopeType: patch.scopeType ?? m.scopeType,
            groups: patch.groups ?? m.groups,
            phones: patch.phones ?? m.phones,
          }),
          'Could not update scope',
        )
      }
    },
    [enabled, teamId, mockUpdate, run],
  )

  const setOverride = useCallback(
    (m: RosterMember, key: PermissionKey, effect: OverrideEffect | null) => {
      if (!enabled) { mockSetOverride(m.id, key, effect); return }
      if (!teamId || !m.userId) return
      const next = { ...m.overrides }
      if (effect === null) delete next[key]
      else next[key] = effect
      run(setMemberOverrides(teamId, m.userId, next), 'Could not update permission')
    },
    [enabled, teamId, mockSetOverride, run],
  )

  const setSuspended = useCallback(
    (m: RosterMember, suspended: boolean) => {
      if (!enabled) { mockSetSuspended(m.id, suspended); return }
      if (!teamId || !m.userId) return
      run(setMemberStatus(teamId, m.userId, suspended ? 'suspended' : 'active'), 'Could not update member')
    },
    [enabled, teamId, mockSetSuspended, run],
  )

  const removeEmployee = useCallback(
    (m: RosterMember) => {
      if (!enabled) { mockRemove(m.id); return }
      if (m.status === 'invited' && m.inviteId) { run(svcRevokeInvite(m.inviteId), 'Could not revoke invite'); return }
      if (teamId && m.userId) run(removeMember(teamId, m.userId), 'Could not remove member')
    },
    [enabled, teamId, mockRemove, run],
  )

  const addEmployee = useCallback(
    async (input: { name: string; email: string; role: RoleId }): Promise<AddResult> => {
      if (!enabled) {
        mockAdd({ name: input.name, email: input.email, role: input.role, groups: [] })
        return { invited: false }
      }
      if (!teamId || !user) throw new Error('No active team')
      const invite = await svcCreateInvite({ teamId, email: input.email, role: input.role, invitedBy: user.id })
      const emailRes = await sendInviteEmail(invite.id)
      await teamCtx.refresh()
      return { invited: true, url: inviteUrl(invite.token), emailed: emailRes.ok }
    },
    [enabled, teamId, user, mockAdd, teamCtx],
  )

  const startShift = useCallback((id: string) => (enabled ? ovStart(id) : mockStart(id)), [enabled, ovStart, mockStart])
  const endShift = useCallback((id: string) => (enabled ? ovEnd(id) : mockEnd(id)), [enabled, ovEnd, mockEnd])
  const toggleBreak = useCallback((id: string) => (enabled ? ovBreak(id) : mockBreak(id)), [enabled, ovBreak, mockBreak])

  return {
    enabled,
    loading: enabled ? teamCtx.loading : false,
    error: enabled ? teamCtx.error : null,
    employees,
    refresh: teamCtx.refresh,
    updateEmployee,
    setOverride,
    setSuspended,
    removeEmployee,
    addEmployee,
    startShift,
    endShift,
    toggleBreak,
  }
}
