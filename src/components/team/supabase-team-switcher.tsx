import { useState } from 'react'
import { AUTH_SOURCE } from '@/auth/auth-source'
import { isSupabaseConfigured } from '@/lib/supabase'
import { useTeamContext } from '@/contexts/TeamContext'

/**
 * Workspace switcher for SUPABASE-mode. Lists the caller's ACTIVE memberships
 * (team_members + teams via RLS, surfaced by useTeam) and switches the active
 * workspace via TeamContext.switchTeam — which persists the choice (per-user
 * localStorage) and re-resolves the roster, so every team-scoped view (Phones,
 * Jobs, Team, Pair Device, …) and the acting member's permissions follow.
 *
 * Inert unless supabase-mode is active (me-mode uses <TeamSwitcher> instead), on
 * the collapsed icon rail, and when the caller has fewer than two active teams
 * (nothing to switch — the page headers already show the single workspace). A
 * removed/suspended selection is recovered by useTeam's fallback, so this only
 * ever offers teams the user can actually reach.
 */
export function SupabaseTeamSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { teams, team, switchTeam } = useTeamContext()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const supabaseMode = AUTH_SOURCE === 'supabase' && isSupabaseConfigured
  if (!supabaseMode || collapsed) return null
  if (teams.length < 2) return null

  const currentId = team?.id ?? null
  const onChange = async (teamId: string) => {
    if (busy || teamId === currentId) return
    setBusy(true)
    setError(null)
    try {
      await switchTeam(teamId)
    } catch {
      setError('Could not switch workspace.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-b border-white/[0.06] px-4 py-2">
      <label htmlFor="supabase-team-switcher" className="mono mb-1 block text-[8px] uppercase tracking-wider text-white/30">Workspace</label>
      <select
        id="supabase-team-switcher"
        aria-label="Switch workspace"
        disabled={busy}
        value={currentId ?? ''}
        onChange={(e) => void onChange(e.target.value)}
        className="mono h-7 w-full cursor-pointer rounded-control border border-line bg-elevated px-2 text-[11px] text-white/70 outline-none transition-colors focus:border-[var(--accent-border)] disabled:opacity-50"
      >
        {teams.map((t) => (
          <option key={t.id} value={t.id}>{t.name}{t.role ? ` · ${t.role}` : ''}</option>
        ))}
      </select>
      {error && <p role="alert" className="mt-1 text-[10px] leading-tight text-red-400">{error}</p>}
    </div>
  )
}
