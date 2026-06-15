import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { TeamInviteRow, TeamMemberRow, TeamRole, TeamRow } from '@/lib/database.types'
import { useAuth } from '@/contexts/AuthContext'
import { peekPendingInvite, takePendingTeamName } from '@/contexts/onboarding'

export interface UseTeam {
  /** True when Supabase is configured. */
  enabled: boolean
  loading: boolean
  error: string | null
  /** Membership exists but is NOT active (suspended/removed) — distinct from "no team". */
  suspended: boolean
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
  /** Deliberately create this user's FIRST team (as owner) and refresh. Idempotent;
   *  RLS + the owner-bootstrap trigger enforce that the browser can't insert an
   *  arbitrary owner membership. Used by the onboarding flow. */
  provisionTeam: (name?: string) => Promise<{ error?: string }>
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
  // the live views. The id is a stable string across refreshes. (provisionTeam reads
  // the live email/id straight from the client via getUser(), so we don't keep it here.)
  const userId = user?.id ?? null

  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const [team, setTeam] = useState<TeamRow | null>(null)
  const [members, setMembers] = useState<TeamMemberRow[]>([])
  const [invites, setInvites] = useState<TeamInviteRow[]>([])
  const [role, setRole] = useState<TeamRole | null>(null)
  const [suspended, setSuspended] = useState(false)

  // `isActive` lets a still-mounted effect bail before committing state, so a
  // stale in-flight load (after a user/team change) can't clobber the current
  // one — mirrors the cancellation guard in AuthContext.
  const load = useCallback(async (isActive: () => boolean = () => true) => {
    if (!supabase || !userId) {
      if (isActive()) { setTeam(null); setMembers([]); setInvites([]); setRole(null); setSuspended(false); setLoading(false) }
      return
    }
    const sb = supabase
    if (isActive()) { setLoading(true); setError(null); setSuspended(false) }

    // Active team = the user's first membership (RLS ensures it's theirs).
    const { data: memberships, error: mErr } = await sb
      .from('team_members')
      .select(MEMBERSHIP_SELECT)
      .eq('user_id', userId)
      .order('joined_at', { ascending: true })
    if (!isActive()) return
    if (mErr) { setError(mErr.message); setLoading(false); return }

    const activeTeam = (memberships?.[0]?.teams as TeamRow | undefined) ?? null
    const activeRole = (memberships?.[0]?.role as TeamRole | undefined) ?? null

    // No ACTIVE team. Classify the state — but do NOT auto-provision here. Team
    // creation is a deliberate onboarding step (provisionTeam), so a slow or raced
    // data load can never silently create a team, skip one, or strand the user on a
    // permission-denied dashboard. The three outcomes:
    //   • pending invite   → leave team null; the gate redirects to /invite to redeem it
    //   • suspended/removed → has_any_membership sees the row RLS hides → suspended state
    //   • genuine new user  → team null, not suspended, no error → onboarding required
    if (!activeTeam && !peekPendingInvite()) {
      const { data: hasMembership, error: rpcErr } = await sb.rpc('has_any_membership')
      if (!isActive()) return
      if (rpcErr) {
        // API/DB failure — NEVER misclassify as "no team / onboarding required".
        setError('Unable to load your workspace. Please try again.')
        setTeam(null); setMembers([]); setInvites([]); setRole(null); setSuspended(false); setLoading(false)
        return
      }
      if (hasMembership) {
        // Membership exists but isn't active → suspended/removed. Do NOT hand them a
        // fresh owner workspace (that would escape suspension); the gate shows it.
        setSuspended(true)
        setTeam(null); setMembers([]); setInvites([]); setRole(null); setLoading(false)
        return
      }
      // else: genuine first sign-in with no membership → onboarding required.
    }

    if (!activeTeam) { setTeam(null); setMembers([]); setInvites([]); setRole(null); setSuspended(false); setLoading(false); return }

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
  }, [userId]) // userEmail is only used by provisionTeam, not by the resolve path

  /**
   * Deliberately provision this user's FIRST team (as owner), then refresh. The gate
   * routes a no-team user to onboarding, which calls this. Server-enforced: RLS only
   * permits inserting a `teams` row with owner_user_id = the authenticated user, and
   * the schema's owner-bootstrap trigger creates the owner membership — the browser
   * cannot insert an arbitrary owner membership or pick another user/role. Idempotent:
   * if a membership already exists it adopts it, and a unique-violation (concurrent
   * submit / two tabs) is treated as success and re-resolved — so at most one first
   * team is created.
   */
  const provisionTeam = useCallback(async (name?: string): Promise<{ error?: string }> => {
    if (!supabase) return { error: 'Authentication is not configured.' }
    const sb = supabase
    // Resolve the CURRENT authenticated user straight from the Supabase client (a
    // server-validated read), NOT a possibly-stale id from React state. The RLS
    // INSERT policy on `teams` is `with check (owner_user_id = auth.uid())`, so the
    // row's owner_user_id must equal this id AND the insert must travel on the
    // authenticated client's JWT. getUser() guarantees both: it confirms the live
    // session (the same client then sends its bearer token on the insert) and yields
    // the exact id the server evaluates as auth.uid(). A bad/expired session fails
    // here with a clear "sign in" message instead of an opaque RLS violation.
    const { data: authData, error: authErr } = await sb.auth.getUser()
    const uid = authData?.user?.id
    if (authErr || !uid) return { error: 'You must be signed in to create a workspace.' }
    // Already a member somewhere? Don't create a second first-team.
    const { data: existing, error: exErr } = await sb.from('team_members').select('team_id').eq('user_id', uid).limit(1)
    if (exErr) return { error: exErr.message }
    if (existing && existing.length > 0) { await load(); return {} } // already a member → adopt it
    const teamName = (name ?? takePendingTeamName() ?? `${(authData.user.email ?? 'My').split('@')[0]}'s Workspace`).trim() || 'My Workspace'
    // owner_user_id is explicitly the authenticated uid → satisfies the RLS with-check.
    const { error: cErr } = await sb.from('teams').insert({ name: teamName, owner_user_id: uid }).select().single()
    // 23505 = uniq_team_owner clash: a concurrent request already provisioned it.
    if (cErr && cErr.code !== '23505') return { error: cErr.message }
    await load() // re-resolve → team + owner role (created by the owner-bootstrap trigger)
    return {}
  }, [load])

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

  return { enabled, loading, error, suspended, team, members, invites, currentMember, role, refresh: load, provisionTeam }
}
