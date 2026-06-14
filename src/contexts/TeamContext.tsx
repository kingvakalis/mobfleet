import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { setActiveTeam } from '@/lib/provider/auth-token'
import { useTeam, type UseTeam } from '@/hooks/useTeam'

/**
 * After auth, loads the user's active team (+ members + role) once and provides
 * it app-wide, so pages don't each re-query. Also mirrors the active team id
 * into the provider token-seam (used by the optional Fastify backend path).
 */
const TeamContext = createContext<UseTeam | null>(null)

export function TeamProvider({ children }: { children: ReactNode }) {
  const team = useTeam()

  useEffect(() => {
    setActiveTeam(team.team?.id ?? null)
  }, [team.team?.id])

  return <TeamContext.Provider value={team}>{children}</TeamContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTeamContext(): UseTeam {
  const ctx = useContext(TeamContext)
  if (!ctx) throw new Error('useTeamContext must be used within <TeamProvider>')
  return ctx
}
