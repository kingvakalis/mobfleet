import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { TaskType } from '@/shared/types'

/**
 * Workspace-level automation customizations layered over the provider list:
 *  - pause/resume state per automation
 *  - operator-built custom automations (step sequences)
 *
 * BACKEND INTEGRATION POINT: the server already persists automation run
 * counts (`listAutomations`). When it grows pause/create endpoints, forward
 * these actions through `client` — the store shape is the contract.
 */

export type StepKind = 'start' | 'open-app' | 'wait' | 'tap' | 'type' | 'swipe' | 'screenshot' | 'end'

export interface AutomationStep {
  id: string
  kind: StepKind
  /** Free-text config: app name, wait seconds, text to type, etc. */
  config: string
}

export interface CustomAutomation {
  id: string
  name: string
  description: string
  taskType: TaskType
  steps: AutomationStep[]
  createdAt: number
}

export const STEP_META: Record<StepKind, { label: string; color: string; configHint?: string }> = {
  'start':      { label: 'Start',      color: '#34d399' },
  'open-app':   { label: 'Open App',   color: '#2dd4bf', configHint: 'App name' },
  'wait':       { label: 'Wait',       color: '#fbbf24', configHint: 'Seconds' },
  'tap':        { label: 'Tap',        color: '#4fc3f7', configHint: 'Target (x,y or element)' },
  'type':       { label: 'Type',       color: '#4fc3f7', configHint: 'Text to type' },
  'swipe':      { label: 'Swipe',      color: '#4fc3f7', configHint: 'Direction' },
  'screenshot': { label: 'Screenshot', color: '#38bdf8' },
  'end':        { label: 'End',        color: '#ff4d4d' },
}

const uid = () => Math.random().toString(36).slice(2, 9)

export const defaultSteps = (): AutomationStep[] => [
  { id: uid(), kind: 'start', config: '' },
  { id: uid(), kind: 'open-app', config: 'Instagram' },
  { id: uid(), kind: 'wait', config: '3' },
  { id: uid(), kind: 'end', config: '' },
]

interface AutomationLocalState {
  paused: Record<string, boolean>
  custom: CustomAutomation[]
  togglePaused: (id: string) => void
  saveCustom: (a: Omit<CustomAutomation, 'createdAt'>) => void
  removeCustom: (id: string) => void
}

export const useAutomationLocal = create<AutomationLocalState>()(
  persist(
    (set) => ({
      paused: {},
      custom: [],
      togglePaused: (id) =>
        set((s) => ({ paused: { ...s.paused, [id]: !s.paused[id] } })),
      saveCustom: (a) =>
        set((s) => {
          const existing = s.custom.find((c) => c.id === a.id)
          return {
            custom: existing
              ? s.custom.map((c) => (c.id === a.id ? { ...c, ...a } : c))
              : [...s.custom, { ...a, createdAt: Date.now() }],
          }
        }),
      removeCustom: (id) =>
        set((s) => ({ custom: s.custom.filter((c) => c.id !== id) })),
    }),
    { name: 'mobfleet-automations-v1' },
  ),
)

export const newStepId = uid
