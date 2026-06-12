import { create } from 'zustand'
import type { View } from '@/lib/views'

/** Fleet filters — session-scoped, shared by the 2D and 3D views so they
 *  survive view switches and phone-control round-trips. */
export interface FleetFilters {
  search: string
  status: string | null
  groups: string[]
  model: string | null
  job: string | null
  /** false = dim non-matching (default), true = hide them entirely. */
  hideNonMatching: boolean
}

export const EMPTY_FLEET_FILTERS: FleetFilters = {
  search: '', status: null, groups: [], model: null, job: null, hideNonMatching: false,
}

export function fleetFiltersActive(f: FleetFilters): boolean {
  return f.search !== '' || f.status !== null || f.groups.length > 0 || f.model !== null || f.job !== null
}

/** Cross-tree UI state: active view, drawer, scale & submit overlays, palette. */
interface UIState {
  view: View
  setView: (v: View) => void

  fleetFilters: FleetFilters
  setFleetFilters: (f: FleetFilters) => void
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

  phoneControlDeviceId: string | null
  openPhoneControl: (id: string) => void
  closePhoneControl: () => void
}

export const useUIStore = create<UIState>((set) => ({
  view: 'fleet',
  setView: (view) => set({ view }),

  fleetFilters: EMPTY_FLEET_FILTERS,
  setFleetFilters: (fleetFilters) => set({ fleetFilters }),
  focusGroup: (g) => set({ view: 'fleet', fleetFilters: { ...EMPTY_FLEET_FILTERS, groups: [g] } }),

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

  phoneControlDeviceId: null,
  openPhoneControl: (id) => set({ phoneControlDeviceId: id, view: 'phone-control' }),
  closePhoneControl: () => set({ phoneControlDeviceId: null, view: 'phones' }),
}))
