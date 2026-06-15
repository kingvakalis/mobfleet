import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { TeamInviteRow, TeamMemberRow, TeamRole, TeamRow } from '@/lib/database.types'
import { useAuth } from '@/contexts/AuthContext'
import { peekPendingInvite, takePendingTeamName } from '@/contexts/onboarding'

export interface UseTeam {
  /** True when Supabase is configured. */
  enabled: boolean
  loading: boolean
  error: string | null
  team: TeamRow | null
  /** Full roster (active + suspended) for the active team. */
  members: TeamMemberRow[]
  /** Pending invitations for the active team (empty unless the caller is admin). */
  invites: TeamInviteRow[]
  /** The current user's member row in the active team (role, scope, overrides). */
  currentMember: TeamMemberRow | null
  /** The current user's role in the active team. */
  role: TeamRole | null
  refresh: () => Promise<void>
}

const MEMBERSHIP_SELECT = 'role, team_id, teams ( id, name, owner_user_id, created_at )'

/**
 * Resolves the signed-in user's active team (their first membership), its full
 * roster + pending invites, and their role — all through RLS, so a user only ever
 * sees teams they belong to. On first login with no team it provisions one (with
 * the user as OWNER via the schema's owner-bootstrap trigger), using the
 * workspace name stashed at signup.
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
  const [invites, setInvites] = useState<TeamInviteRow[]>([])
  const [role, setRole] = useState<TeamRole | null>(null)
  const provisioning = useRef(false)

  // `isActive` lets a still-mounted effect bail before committing state, so a
  // stale in-flight load (after a user/team change) can't clobber the current
  // one — mirrors the cancellation guard in AuthContext.
  const load = useCallback(async (isActive: () => boolean = () => true) => {
    if (!supabase || !userId) {
      if (isActive()) { setTeam(null); setMembers([]); setInvites([]); setRole(null); setLoading(false) }
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
    // EXCEPT when an invite is pending: the invitee must JOIN the inviter's team
    // (via accept_invite), not get their own auto-provisioned workspace.
    if (!activeTeam && !provisioning.current && !peekPendingInvite()) {
      // Distinguish a genuine first login (no membership → provision) from a
      // SUSPENDED/removed member whose rows RLS hides (membership exists but is
      // not 'active'). Provisioning for the latter would ESCAPE suspension by
      // handing them a fresh owner workspace, so we must not.
      const { data: hasMembership } = await sb.rpc('has_any_membership')
      if (!isActive()) return
      if (hasMembership) {
        setError('Your access to this workspace has been suspended. Contact a workspace admin.')
        setTeam(null); setMembers([]); setInvites([]); setRole(null); setLoading(false)
        return
      }
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

    // #region agent log
    fetch('http://127.0.0.1:7627/ingest/1b257ea2-3233-4b89-b6f7-a1d72b0f2da3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a33ba4'},body:JSON.stringify({sessionId:'a33ba4',runId:'pre-fix',hypothesisId:'B,E',location:'useTeam.ts:120',message:'useTeam resolved membership',data:{membershipsCount:memberships?.length??0,activeTeamId:activeTeam?.id??null,activeRole:activeRole??null,pendingInvite:peekPendingInvite()},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (!activeTeam) { setTeam(null); setMembers([]); setInvites([]); setRole(null); setLoading(false); return }

    // Full roster + pending invites (invites are admin-only via RLS → [] for others).
    const [{ data: mem, error: rosterErr }, { data: inv }] = await Promise.all([
      sb.from('team_members').select('*').eq('team_id', activeTeam.id).order('joined_at', { ascending: true }),
      sb.from('team_invites').select('*').eq('team_id', activeTeam.id).eq('status', 'pending').order('created_at', { ascending: true }),
    ])
    if (!isActive()) return
    if (rosterErr) { setError(rosterErr.message) }

    setTeam(activeTeam)
    setRole(activeRole)
    setMembers((mem as TeamMemberRow[]) ?? [])
    setInvites((inv as TeamInviteRow[]) ?? [])
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

  const currentMember = (userId ? members.find((m) => m.user_id === userId) : null) ?? null

  return { enabled, loading, error, team, members, invites, currentMember, role, refresh: load }
}
