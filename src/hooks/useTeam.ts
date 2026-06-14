import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { TeamMemberRow, TeamRole, TeamRow } from '@/lib/database.types'
import { useAuth } from '@/contexts/AuthContext'
import { takePendingTeamName } from '@/contexts/onboarding'

export interface UseTeam {
  /** True when Supabase is configured. */
  enabled: boolean
  loading: boolean
  error: string | null
  team: TeamRow | null
  members: TeamMemberRow[]
  /** The current user's role in the active team. */
  role: TeamRole | null
  refresh: () => Promise<void>
}

const MEMBERSHIP_SELECT = 'role, team_id, teams ( id, name, owner_user_id, created_at )'

/**
 * Resolves the signed-in user's active team (their first membership), its
 * members, and their role — all through RLS, so a user only ever sees teams
 * they belong to. On first login with no team it provisions one (with the user
 * as OWNER via the schema's owner-bootstrap trigger), using the workspace name
 * stashed at signup.
 */
export function useTeam(): UseTeam {
  const { enabled, user } = useAuth()
  // Key reloads on the STABLE user id, not the `user` object — Supabase hands us
  // a fresh `user` reference on every silent token refresh (~hourly / on focus),
  // and depending on the object would re-fire the load + flash a spinner + remount
  // the live views. id/email are stable strings across refreshes.
  const userId = user?.id ?? null
  const userEmail = user?.email ?? null

  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const [team, setTeam] = useState<TeamRow | null>(null)
  const [members, setMembers] = useState<TeamMemberRow[]>([])
  const [role, setRole] = useState<TeamRole | null>(null)
  const provisioning = useRef(false)

  // `isActive` lets a still-mounted effect bail before committing state, so a
  // stale in-flight load (after a user/team change) can't clobber the current
  // one — mirrors the cancellation guard in AuthContext.
  const load = useCallback(async (isActive: () => boolean = () => true) => {
    if (!supabase || !userId) {
      if (isActive()) { setTeam(null); setMembers([]); setRole(null); setLoading(false) }
      return
    }
    const sb = supabase
    if (isActive()) { setLoading(true); setError(null) }

    // Active team = the user's first membership (RLS ensures it's theirs).
    const { data: memberships, error: mErr } = await sb
      .from('team_members')
      .select(MEMBERSHIP_SELECT)
      .eq('user_id', userId)
      .order('joined_at', { ascending: true })
    if (!isActive()) return
    if (mErr) { setError(mErr.message); setLoading(false); return }

    let activeTeam = (memberships?.[0]?.teams as TeamRow | undefined) ?? null
    let activeRole = (memberships?.[0]?.role as TeamRole | undefined) ?? null

    // No team yet → provision one with this user as owner (the ref guards the
    // common double-invoke; the DB's uniq_team_owner index is the real backstop).
    if (!activeTeam && !provisioning.current) {
      provisioning.current = true
      const name = takePendingTeamName() ?? `${(userEmail ?? 'My').split('@')[0]}'s Workspace`
      const { data: created, error: cErr } = await sb
        .from('teams')
        .insert({ name, owner_user_id: userId })
        .select()
        .single()
      provisioning.current = false
      if (!isActive()) return
      if (cErr) {
        // 23505 = unique_violation on uniq_team_owner: a concurrent load already
        // provisioned this owner's team. Treat it as "already done" and adopt the
        // team that won, rather than surfacing a spurious error.
        if (cErr.code === '23505') {
          const { data: retry } = await sb
            .from('team_members')
            .select(MEMBERSHIP_SELECT)
            .eq('user_id', userId)
            .order('joined_at', { ascending: true })
          if (!isActive()) return
          activeTeam = (retry?.[0]?.teams as TeamRow | undefined) ?? null
          activeRole = (retry?.[0]?.role as TeamRole | undefined) ?? null
        } else {
          setError(cErr.message); setLoading(false); return
        }
      } else {
        activeTeam = created as TeamRow
        activeRole = 'owner'
      }
    }

    if (!activeTeam) { setTeam(null); setMembers([]); setRole(null); setLoading(false); return }

    const { data: mem, error: rosterErr } = await sb
      .from('team_members')
      .select('id, team_id, user_id, role, invited_at, joined_at')
      .eq('team_id', activeTeam.id)
      .order('joined_at', { ascending: true })
    if (!isActive()) return
    if (rosterErr) { setError(rosterErr.message) }

    setTeam(activeTeam)
    setRole(activeRole)
    setMembers((mem as TeamMemberRow[]) ?? [])
    setLoading(false)
  }, [userId, userEmail])

  useEffect(() => {
    // loading initialises to `enabled`; when disabled there's nothing to load
    // (and we avoid any synchronous setState in the effect body). `load` handles
    // the signed-out case and re-runs only on a genuine user change (its deps are
    // the stable id/email).
    if (!enabled) return
    let active = true
    // Async data-load effect — the loading flag it sets is the intended pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(() => active)
    return () => { active = false }
  }, [enabled, load])

  return { enabled, loading, error, team, members, role, refresh: load }
}
