import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  DEFAULT_EMAIL_PREFERENCES,
  normalizeEmailPreferences,
  type EmailPreferences,
} from '@/lib/email/preferences'

/**
 * Workspace email preferences — which transactional emails are enabled.
 *
 * Persisted locally (zustand/persist → localStorage) under its OWN key, kept
 * separate from `mobfleet-settings` on purpose: these toggles persist
 * IMMEDIATELY on change, whereas the workspace Settings page uses an explicit
 * draft + Save cycle. Sharing one store would let a stale settings "Save"
 * silently clobber an immediate email toggle, so a dedicated store avoids that
 * undue coupling. It does not introduce competing persistence — the workspace
 * store never reads or writes these keys.
 *
 * BACKEND INTEGRATION POINT:
 * These preferences currently persist locally for UI configuration.
 * When the workspace email-settings API is available:
 * 1. Load preferences from GET /v1/settings/email
 * 2. Persist updates through PATCH /v1/settings/email
 * 3. Enforce the settings inside the server email-dispatch layer
 * 4. Use server state as the source of truth
 */

const PERSIST_KEY = 'mobfleet-email-settings'
const PERSIST_VERSION = 1

function devWarn(reason: string): void {
  try {
    // import.meta.env is provided by Vite; absent under non-Vite runtimes.
    if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
      console.warn(`[email-settings] ${reason}`)
    }
  } catch {
    /* no-op: import.meta.env unavailable */
  }
}

interface EmailSettingsState extends EmailPreferences {
  /** Toggle a single preference. Persists immediately (no Save step). */
  setPreference: <K extends keyof EmailPreferences>(key: K, value: EmailPreferences[K]) => void
  /** Replace one or more preferences (used by the future backend-sync adapter). */
  update: (patch: Partial<EmailPreferences>) => void
  reset: () => void
}

export const useEmailSettings = create<EmailSettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_EMAIL_PREFERENCES,
      setPreference: (key, value) => set({ [key]: value } as Partial<EmailPreferences>),
      update: (patch) => set(patch),
      reset: () => set(DEFAULT_EMAIL_PREFERENCES),
    }),
    {
      name: PERSIST_KEY,
      version: PERSIST_VERSION,
      // Normalize on every rehydrate: missing/invalid fields fall back to
      // defaults while existing valid prefs are preserved.
      merge: (persisted, current) => ({
        ...current,
        ...normalizeEmailPreferences(persisted, devWarn),
      }),
      // Upgrade older persisted blobs by defaulting any missing email prefs and
      // preserving valid stored values.
      migrate: (persisted) => normalizeEmailPreferences(persisted, devWarn),
    },
  ),
)
