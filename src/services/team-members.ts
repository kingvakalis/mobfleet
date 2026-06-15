import { supabase } from '@/lib/supabase'
import type { TeamInviteRow, TeamMemberRow, TeamMemberUpdate } from '@/lib/database.types'
import type { RoleId } from '@/lib/authorization/roles'
import type { ScopeType } from '@/lib/authorization/scopes'
import type { PermissionKey } from '@/lib/authorization/permissions'
import type { OverrideEffect } from '@/lib/authorization/effective-access'
import type { Employee } from './team'

/**
 * Supabase-native roster service. Converts team_members + team_invites rows into
 * the Employee shape the Team UI + authorization engine already speak, and wraps
 * every member mutation (role / suspend / remove / scope / overrides) and the
 * invite lifecycle (create / email / revoke).
 *
 * IMPORTANT: there is no shift/activity backend, so real members carry ZEROED
 * activity (no fabricated shifts) — the Team view already discloses that shift
 * data is tracked locally until a session backend exists. Identity, role, status,
 * scope and overrides are real, RLS-enforced Supabase data.
 */

export type RosterStatus = 'invited' | 'active' | 'suspended'

/** A roster entry: an Employee plus its Supabase provenance + display status. */
export interface RosterMember extends Employee {
  status: RosterStatus
  /** Supabase auth user id (active/suspended members); null for pending invites. */
  userId: string | null
  /** team_invites.id — present only for pending invites (revoke / resend). */
  inviteId?: string
  /** team_invites.token — present only for pending invites (copy-link). */
  inviteToken?: string
}

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

const asOverrides = (v: unknown): Partial<Record<PermissionKey, OverrideEffect>> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Partial<Record<PermissionKey, OverrideEffect>>) : {}

const ms = (iso: string | null | undefined): number => (iso ? new Date(iso).getTime() : Date.now())

/** Activity fields zeroed — there is no shift backend; never fabricate shifts. */
const blankActivity = () => ({
  shiftStatus: 'offline' as const,
  shiftStart: null,
  breakStart: null,
  breakMinutesToday: 0,
  currentPhone: null,
  currentSessionStart: null,
  lastActivity: 0,
  history: [],
})

/** team_members row → RosterMember (engine identity = user_id, so actor===target
 *  self-checks line up with the signed-in user). */
export function memberToRoster(row: TeamMemberRow): RosterMember {
  return {
    id: row.user_id,
    userId: row.user_id,
    name: row.name ?? row.email ?? 'Member',
    email: row.email ?? '',
    role: row.role as RoleId,
    groups: asStringArray(row.scope_groups),
    phones: asStringArray(row.scope_phones),
    scopeType: (row.scope_type as ScopeType) ?? 'workspace',
    overrides: asOverrides(row.overrides),
    createdAt: ms(row.joined_at ?? row.invited_at),
    suspended: row.status === 'suspended',
    status: row.status === 'suspended' ? 'suspended' : 'active',
    ...blankActivity(),
  }
}

/** team_invites row (pending) → RosterMember shown as "invited". */
export function inviteToRoster(inv: TeamInviteRow): RosterMember {
  return {
    id: `invite:${inv.id}`,
    userId: null,
    inviteId: inv.id,
    inviteToken: inv.token,
    name: inv.email,
    email: inv.email,
    role: inv.role as RoleId,
    groups: [],
    phones: [],
    scopeType: 'workspace',
    overrides: {},
    createdAt: ms(inv.created_at),
    suspended: false,
    status: 'invited',
    ...blankActivity(),
  }
}

/** Absolute accept link for an invite token (env-correct origin). */
export function inviteUrl(token: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/invite?token=${encodeURIComponent(token)}`
}

const noClient = () => new Error('Supabase is not configured')

/** Load active/suspended members + pending invites for a team. */
export async function fetchRoster(teamId: string): Promise<{ members: TeamMemberRow[]; invites: TeamInviteRow[] }> {
  if (!supabase) throw noClient()
  const [m, i] = await Promise.all([
    supabase.from('team_members').select('*').eq('team_id', teamId).order('joined_at', { ascending: true }),
    supabase.from('team_invites').select('*').eq('team_id', teamId).eq('status', 'pending').order('created_at', { ascending: true }),
  ])
  if (m.error) throw m.error
  if (i.error) throw i.error
  return { members: m.data ?? [], invites: i.data ?? [] }
}

export async function createInvite(input: {
  teamId: string
  email: string
  role: RoleId
  invitedBy: string
}): Promise<TeamInviteRow> {
  if (!supabase) throw noClient()
  const { data, error } = await supabase
    .from('team_invites')
    .insert({ team_id: input.teamId, email: input.email.trim().toLowerCase(), role: input.role, invited_by: input.invitedBy })
    .select()
    .single()
  if (error) throw error
  return data
}

/** Best-effort: ask the Edge Function to email the invite via Resend. The UI
 *  still surfaces a copy-link, so a failure here never blocks inviting. */
export async function sendInviteEmail(inviteId: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'not configured' }
  try {
    const { error } = await supabase.functions.invoke('send-invite', { body: { inviteId } })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send failed' }
  }
}

export async function revokeInvite(inviteId: string): Promise<void> {
  if (!supabase) throw noClient()
  const { error } = await supabase.from('team_invites').update({ status: 'revoked' }).eq('id', inviteId)
  if (error) throw error
}

async function updateMember(teamId: string, userId: string, patch: TeamMemberUpdate): Promise<void> {
  if (!supabase) throw noClient()
  const { error } = await supabase.from('team_members').update(patch).eq('team_id', teamId).eq('user_id', userId)
  if (error) throw error
}

export const updateMemberRole = (teamId: string, userId: string, role: RoleId) =>
  updateMember(teamId, userId, { role })

export const setMemberStatus = (teamId: string, userId: string, status: 'active' | 'suspended') =>
  updateMember(teamId, userId, { status })

export const setMemberScope = (
  teamId: string,
  userId: string,
  scope: { scopeType: ScopeType; groups: string[]; phones: string[] },
) => updateMember(teamId, userId, { scope_type: scope.scopeType, scope_groups: scope.groups, scope_phones: scope.phones })

export const setMemberOverrides = (
  teamId: string,
  userId: string,
  overrides: Partial<Record<PermissionKey, OverrideEffect>>,
) => updateMember(teamId, userId, { overrides })

export async function removeMember(teamId: string, userId: string): Promise<void> {
  if (!supabase) throw noClient()
  const { error } = await supabase.from('team_members').delete().eq('team_id', teamId).eq('user_id', userId)
  if (error) throw error
}
