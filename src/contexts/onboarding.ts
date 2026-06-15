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

/**
 * A pending invite token, stashed at signup (`/signup?invite=…`) so it survives
 * the email-confirmation gap. After first login the OnboardingGate redirects to
 * /invite?token=… to redeem it, and the invite page clears it.
 */
const INVITE_KEY = 'mobfleet-pending-invite'

export const stashPendingInvite = (token: string): void => localStorage.setItem(INVITE_KEY, token)

/** Read the pending invite token WITHOUT clearing it (for routing decisions). */
export const peekPendingInvite = (): string | null => localStorage.getItem(INVITE_KEY) || null

/** Discard any pending invite token (on redeem or logout). */
export const clearPendingInvite = (): void => localStorage.removeItem(INVITE_KEY)

/**
 * The onboarding wizard's resume key. Cleared on logout so one user's in-progress
 * answers (name, company, goals) can't bleed into the next user's wizard on a
 * shared browser — same hygiene as the stashes above.
 */
export const ONBOARDING_PROGRESS_KEY = 'mobfleet-onboarding-progress'

export const clearOnboardingProgress = (): void => localStorage.removeItem(ONBOARDING_PROGRESS_KEY)
