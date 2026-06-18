import { useState } from 'react'
import { useAuthz } from '@/contexts/AuthzContext'
import { ApiError } from '@/services/me-client'

/**
 * Minimal team switcher for the authoritative ("me") path. Lists the caller's ACTIVE
 * teams from /v1/me, marks the current one, and switches via POST /v1/me/team
 * (AuthzContext.switchTeam — server-validated; it updates the x-team-id header,
 * reloads /v1/me, and bumps teamEpoch so team-scoped views drop stale data).
 *
 * Inert in supabase-mode (AuthzContext inactive → renders nothing) so production is
 * unchanged, on the icon rail (collapsed), and when the caller has fewer than two
 * active teams (nothing to switch). A suspended/removed/foreign team is rejected
 * server-side (403) and surfaced here rather than silently switching anywhere.
 */
export function TeamSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { active, teams, me, switchTeam } = useAuthz()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!active || collapsed) return null
  const activeTeams = teams.filter((t) => t.status === 'active')
  const currentId = me?.team?.id ?? null
  if (activeTeams.length < 2) return null

  const onChange = async (teamId: string) => {
    if (busy || teamId === currentId) return
    setBusy(true)
    setError(null)
    try {
      await switchTeam(teamId)
    } catch (e) {
      // Suspended / removed / foreign membership → server 403 (never a silent switch).
      setError(e instanceof ApiError && e.status === 403
        ? 'That workspace is no longer available to you.'
        : 'Could not switch workspace.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-b border-white/[0.06] px-4 py-2">
      <label htmlFor="team-switcher" className="mono mb-1 block text-[8px] uppercase tracking-wider text-white/30">Workspace</label>
      <select
        id="team-switcher"
        aria-label="Switch workspace"
        disabled={busy}
        value={currentId ?? ''}
        onChange={(e) => void onChange(e.target.value)}
        className="mono h-7 w-full cursor-pointer rounded-control border border-line bg-elevated px-2 text-[11px] text-white/70 outline-none transition-colors focus:border-[var(--accent-border)] disabled:opacity-50"
      >
        {activeTeams.map((t) => (
          <option key={t.teamId} value={t.teamId}>{t.name}{t.role ? ` · ${t.role}` : ''}</option>
        ))}
      </select>
      {error && <p role="alert" className="mt-1 text-[10px] leading-tight text-red-400">{error}</p>}
    </div>
  )
}
