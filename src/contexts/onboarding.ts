/**
 * Carries the workspace name chosen at signup across the (possibly
 * email-confirmation-gated) gap until the user is first authenticated, when
 * TeamContext provisions their team with them as OWNER.
 */
const KEY = 'mobfleet-pending-team-name'

export const stashPendingTeamName = (name: string): void => localStorage.setItem(KEY, name)

/** Read and clear the pending workspace name (one-shot). */
export const takePendingTeamName = (): string | null => {
  const v = localStorage.getItem(KEY)
  if (v) localStorage.removeItem(KEY)
  return v || null
}

/** Discard any pending workspace name (e.g. on logout) without consuming it. */
export const clearPendingTeamName = (): void => localStorage.removeItem(KEY)
