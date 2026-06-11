import { create } from 'zustand'
import type { View } from '@/lib/views'

/** Cross-tree UI state: active view, drawer, scale & submit overlays, palette. */
interface UIState {
  view: View
  setView: (v: View) => void

  /** Active group filter on the fleet graph (null = all). */
  groupFilter: string | null
  setGroupFilter: (g: string | null) => void
  /** Jump to the fleet view filtered to a group. */
  focusGroup: (g: string) => void

  drawerDeviceId: string | null
  openDrawer: (id: string) => void
  closeDrawer: () => void

  scaleOpen: boolean
  openScale: () => void
  closeScale: () => void

  submitOpen: boolean
  /** Preselected automation when the dispatch dialog opens. */
  submitAutomationId: string | null
  openSubmit: (automationId?: string) => void
  closeSubmit: () => void

  paletteOpen: boolean
  openPalette: () => void
  closePalette: () => void
  togglePalette: () => void
}

export const useUIStore = create<UIState>((set) => ({
  view: 'fleet',
  setView: (view) => set({ view }),

  groupFilter: null,
  setGroupFilter: (groupFilter) => set({ groupFilter }),
  focusGroup: (g) => set({ view: 'fleet', groupFilter: g }),

  drawerDeviceId: null,
  openDrawer: (id) => set({ drawerDeviceId: id }),
  closeDrawer: () => set({ drawerDeviceId: null }),

  scaleOpen: false,
  openScale: () => set({ scaleOpen: true }),
  closeScale: () => set({ scaleOpen: false }),

  submitOpen: false,
  submitAutomationId: null,
  openSubmit: (automationId) => set({ submitOpen: true, submitAutomationId: automationId ?? null }),
  closeSubmit: () => set({ submitOpen: false, submitAutomationId: null }),

  paletteOpen: false,
  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
}))
