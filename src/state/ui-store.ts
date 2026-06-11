import { create } from 'zustand'
import type { View } from '@/lib/views'

/** Cross-tree UI state: active view, drawer, scale & submit overlays, palette. */
interface UIState {
  view: View
  setView: (v: View) => void

  drawerDeviceId: string | null
  openDrawer: (id: string) => void
  closeDrawer: () => void

  scaleOpen: boolean
  openScale: () => void
  closeScale: () => void

  submitOpen: boolean
  openSubmit: () => void
  closeSubmit: () => void

  paletteOpen: boolean
  openPalette: () => void
  closePalette: () => void
  togglePalette: () => void
}

export const useUIStore = create<UIState>((set) => ({
  view: 'fleet',
  setView: (view) => set({ view }),

  drawerDeviceId: null,
  openDrawer: (id) => set({ drawerDeviceId: id }),
  closeDrawer: () => set({ drawerDeviceId: null }),

  scaleOpen: false,
  openScale: () => set({ scaleOpen: true }),
  closeScale: () => set({ scaleOpen: false }),

  submitOpen: false,
  openSubmit: () => set({ submitOpen: true }),
  closeSubmit: () => set({ submitOpen: false }),

  paletteOpen: false,
  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
}))
