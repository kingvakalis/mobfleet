/**
 * Auth token + active-team holder for the HTTP provider. The app sets these
 * after the user signs in (Clerk/Supabase) and picks a team; the provider reads
 * them on every REST call and the WebSocket upgrade.
 *
 * Kept deliberately tiny and framework-free so the provider layer has no React
 * dependency. The login UI / team switcher (a follow-up client phase) calls
 * `setAuthToken` / `setActiveTeam`; `onAuthChange` lets the provider reconnect
 * the socket when either changes.
 */
let token: string | null = null
let teamId: string | null = null
const listeners = new Set<() => void>()

export function setAuthToken(next: string | null): void {
  if (token === next) return
  token = next
  listeners.forEach((l) => l())
}
export function getAuthToken(): string | null {
  return token
}

export function setActiveTeam(next: string | null): void {
  if (teamId === next) return
  teamId = next
  listeners.forEach((l) => l())
}
export function getActiveTeam(): string | null {
  return teamId
}

/** Subscribe to token/team changes (the provider reconnects its socket). */
export function onAuthChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
