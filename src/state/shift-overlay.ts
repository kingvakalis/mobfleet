import { create } from 'zustand'
import type { Employee } from '@/services/team'

/**
 * Ephemeral, in-session shift state for the Supabase-backed roster.
 *
 * There is no shift/session backend yet (out of scope for auth wiring), so real
 * members carry zeroed activity. To keep the existing shift-tracking UI alive,
 * the Start/Break/End buttons drive THIS local overlay — clearly non-persistent
 * (it resets on reload), exactly as the Team view already discloses ("tracked
 * locally until backend session events are connected"). It is never written to
 * Supabase and never presented as historical truth.
 */
type Overlay = Pick<
  Employee,
  'shiftStatus' | 'shiftStart' | 'breakStart' | 'breakMinutesToday' | 'currentPhone' | 'currentSessionStart' | 'lastActivity'
>

interface ShiftOverlayState {
  overlay: Record<string, Overlay>
  startShift: (id: string) => void
  endShift: (id: string) => void
  toggleBreak: (id: string) => void
}

export const useShiftOverlay = create<ShiftOverlayState>((set) => ({
  overlay: {},
  startShift: (id) =>
    set((s) => ({
      overlay: {
        ...s.overlay,
        [id]: { shiftStatus: 'on-shift', shiftStart: Date.now(), breakStart: null, breakMinutesToday: 0, currentPhone: null, currentSessionStart: null, lastActivity: Date.now() },
      },
    })),
  endShift: (id) =>
    set((s) => {
      const next = { ...s.overlay }
      delete next[id]
      return { overlay: next }
    }),
  toggleBreak: (id) =>
    set((s) => {
      const cur = s.overlay[id]
      if (!cur) return s
      if (cur.shiftStatus === 'on-break' && cur.breakStart) {
        const mins = Math.round((Date.now() - cur.breakStart) / 60_000)
        return { overlay: { ...s.overlay, [id]: { ...cur, shiftStatus: 'on-shift', breakStart: null, breakMinutesToday: cur.breakMinutesToday + mins } } }
      }
      if (cur.shiftStatus === 'on-shift') {
        return { overlay: { ...s.overlay, [id]: { ...cur, shiftStatus: 'on-break', breakStart: Date.now() } } }
      }
      return s
    }),
}))
