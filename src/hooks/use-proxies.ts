import { useCallback, useEffect, useState } from 'react'
import { fetchProxies, testProxy as testProxyApi, ApiError, type Proxy } from '@/services/proxies-client'
import { useAuthz } from '@/contexts/AuthzContext'
import { AUTH_SOURCE } from '@/auth/auth-source'

// The proxy registry lives ONLY on the Prisma backend, keyed by the Prisma team id. In
// supabase-mode (production) the active team is a Supabase id (a disjoint id space) and there
// is no Supabase proxies table, so `/v1/proxies` would resolve a DIFFERENT (auto-provisioned)
// Prisma team — i.e. it can never reflect this workspace. So we surface a truthful
// "unavailable" state instead of calling the backend (which 401s / would show phantom data).
const PROXIES_AVAILABLE = AUTH_SOURCE === 'me'

export type ProxiesState =
  | { status: 'loading'; proxies: Proxy[] }
  | { status: 'ready'; proxies: Proxy[] }
  | { status: 'unavailable'; proxies: Proxy[] }
  | { status: 'error'; proxies: Proxy[]; error: { status: number | null; message: string } }

export interface UseProxies {
  state: ProxiesState
  /** Re-fetch the registry from the server. */
  refresh: () => Promise<void>
  /** IPs with a connectivity test in flight (for per-row spinners). */
  testing: Set<string>
  /** Run `POST /v1/proxies/:ip/test` and merge the re-checked proxy in place.
   *  Rejects on error (the caller surfaces it); never silently fakes a result. */
  test: (ip: string) => Promise<void>
}

/**
 * Live proxy registry for the dedicated Proxies page. Fetches `GET /v1/proxies`
 * (server gates on `phones.view`) and exposes a per-row connectivity test
 * (`POST /v1/proxies/:ip/test`, gated `phones.control`).
 *
 * Re-fetches when the active team changes (keyed on `AuthzContext.teamEpoch`),
 * mirroring how other team-scoped views drop stale data on a switch. Never
 * downgrades a fetch failure into a fake "no proxies" — an error is surfaced
 * truthfully with the prior list preserved.
 */
export function useProxies(): UseProxies {
  const { teamEpoch } = useAuthz()
  const [state, setState] = useState<ProxiesState>(
    PROXIES_AVAILABLE ? { status: 'loading', proxies: [] } : { status: 'unavailable', proxies: [] },
  )
  const [testing, setTesting] = useState<Set<string>>(new Set())

  const load = useCallback(async (isActive: () => boolean = () => true): Promise<void> => {
    // Supabase-mode: no backend proxy registry for this workspace — report truthfully, never fetch.
    if (!PROXIES_AVAILABLE) { if (isActive()) setState({ status: 'unavailable', proxies: [] }); return }
    if (isActive()) setState((s) => ({ status: 'loading', proxies: s.proxies }))
    try {
      const next = await fetchProxies()
      if (!isActive()) return
      setState({ status: 'ready', proxies: next })
    } catch (e) {
      if (!isActive()) return
      const status = e instanceof ApiError ? e.status : null
      const message = e instanceof Error ? e.message : 'Could not load proxies.'
      // Preserve the prior list so a transient error doesn't blank the table.
      setState((s) => ({ status: 'error', proxies: s.proxies, error: { status, message } }))
    }
  }, [])

  useEffect(() => {
    let alive = true
    // Async data-load effect — the loading flag it sets is the intended pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(() => alive)
    return () => { alive = false }
    // Re-fetch on a deliberate team switch (teamEpoch) — same cache-clear contract
    // every other team-scoped view follows.
  }, [load, teamEpoch])

  const test = useCallback(async (ip: string): Promise<void> => {
    if (!PROXIES_AVAILABLE) return
    setTesting((prev) => new Set(prev).add(ip))
    try {
      const checked = await testProxyApi(ip)
      setState((s) => ({
        ...s,
        proxies: s.proxies.map((p) => (p.ip === ip ? checked : p)),
      }))
    } finally {
      setTesting((prev) => {
        const n = new Set(prev)
        n.delete(ip)
        return n
      })
    }
  }, [])

  return { state, refresh: () => load(), testing, test }
}
