/**
 * Email notification preferences — which transactional emails the workspace
 * sends. Pure, dependency-free logic (no zustand, no DOM, no env) so it is
 * portable to the backend and unit-testable in plain Node.
 */

export interface EmailPreferences {
  /** Send an email when an employee is invited to join the workspace. */
  teamInvitesEnabled: boolean
  /** Send password-reset instructions when a user requests account recovery. */
  passwordResetEnabled: boolean
  /** Send a welcome email after a new account completes signup. */
  welcomeEmailEnabled: boolean
}

export const EMAIL_PREFERENCE_KEYS = [
  'teamInvitesEnabled',
  'passwordResetEnabled',
  'welcomeEmailEnabled',
] as const satisfies readonly (keyof EmailPreferences)[]

/** Defaults: every transactional email is enabled. */
export const DEFAULT_EMAIL_PREFERENCES: EmailPreferences = {
  teamInvitesEnabled: true,
  passwordResetEnabled: true,
  welcomeEmailEnabled: true,
}

/**
 * Coerce unknown persisted/migrated input into a valid `EmailPreferences`.
 * Missing or non-boolean fields fall back to their default, so a corrupt or
 * older stored blob can never break the page. `onInvalid` is invoked when any
 * field had to be defaulted — callers wire it to a dev-only warning.
 */
export function normalizeEmailPreferences(
  raw: unknown,
  onInvalid?: (reason: string) => void,
): EmailPreferences {
  const result: EmailPreferences = { ...DEFAULT_EMAIL_PREFERENCES }
  if (raw === null || typeof raw !== 'object') {
    if (raw !== undefined) onInvalid?.('stored email preferences were not an object; using defaults')
    return result
  }
  const obj = raw as Record<string, unknown>
  let invalid = false
  for (const key of EMAIL_PREFERENCE_KEYS) {
    const value = obj[key]
    if (typeof value === 'boolean') result[key] = value
    else if (value !== undefined) invalid = true
  }
  if (invalid) onInvalid?.('some stored email preference fields were invalid; defaulted them')
  return result
}
