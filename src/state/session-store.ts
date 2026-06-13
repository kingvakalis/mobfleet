import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Session / acting member.
 *
 * The deployed SPA has no auth provider, so "who am I signed in as" is modeled
 * here. It defaults to the workspace Owner. The Team page exposes an
 * "Acting as" switcher (impersonation) so the permission system is observable
 * and testable without a login screen.
 *
 * BACKEND INTEGRATION POINT: when real auth is wired, replace `actingId` with
 * the authenticated membership id from the session/JWT. Everything downstream
 * (guards, scope filtering, the access engine) is unchanged — it already reads
 * the acting member through `useActingMember`.
 */

interface SessionState {
  /** Employee id the operator is acting as. Falls back to the first Owner. */
  actingId: string | null
  setActingId: (id: string) => void
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      actingId: null,
      setActingId: (id) => set({ actingId: id }),
    }),
    { name: 'mobfleet-session-v1' },
  ),
)
