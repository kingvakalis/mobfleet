/**
 * Pure ordering + coalescing for a drained agent_commands batch (Stage-1 latency).
 *
 * The supabase transport drains ALL pending commands for a device in one claim, in no
 * guaranteed order. Without ordering, a tap can sit behind queued screenshot captures
 * (each = WDA capture + compress + upload) in the same batch. This module:
 *   • runs CONTROL gestures (tap/swipe/home/back/lock/unlock/switcher/launch/terminate/type)
 *     BEFORE frame requests, FIFO within a tier (by issuedAt);
 *   • coalesces stale screenshot commands down to the single NEWEST one — it captures the
 *     current screen anyway — so a gesture never waits behind a backlog of old frame
 *     requests and there is no screenshot storm. Keeps exactly ONE frame capture per batch.
 *
 * No DB/schema change: it uses `issuedAt` (the row's created_at) already on each frame.
 * Alias-free + side-effect-free so it unit-tests in plain Node (`node --test`).
 */
import type { AgentCommandAction } from '../../../src/shared/schemas'
import type { AgentCommandFrame } from './types'

/** Operator control gestures — highest dispatch priority (responsive UI). */
export const CONTROL_ACTIONS: ReadonlySet<AgentCommandAction> = new Set<AgentCommandAction>([
  'tap', 'swipe', 'type', 'home', 'back', 'lock', 'unlock', 'switcher', 'launch', 'terminate',
])

/** Dispatch tier (lower runs first): 0 = control gesture, 1 = meta (install/reboot/refresh_apps),
 *  2 = screenshot / frame request. Control always precedes frames. */
export function commandPriority(action: AgentCommandAction): number {
  if (CONTROL_ACTIONS.has(action)) return 0
  if (action === 'screenshot') return 2
  return 1
}

export interface OrderedCommands {
  /** Commands to execute, in dispatch order (control first; at most ONE screenshot, last). */
  toRun: AgentCommandFrame[]
  /** Stale screenshot commands superseded by a newer frame request. Ack these as a no-op
   *  success (no redundant WDA capture) so their client watchers resolve; the kept
   *  screenshot delivers the current frame. */
  superseded: AgentCommandFrame[]
}

/**
 * Order a drained batch: coalesce screenshots to the single newest, then sort control-first
 * (FIFO within each tier). Pure — returns new arrays, never mutates the input.
 */
export function orderDrainedCommands(frames: readonly AgentCommandFrame[]): OrderedCommands {
  const superseded: AgentCommandFrame[] = []
  let newestShot: AgentCommandFrame | null = null
  const rest: AgentCommandFrame[] = []
  for (const f of frames) {
    if (f.action === 'screenshot') {
      if (!newestShot) { newestShot = f; continue }
      // Keep the newer frame request; the older one is superseded (it would only re-capture
      // the same live screen a moment earlier).
      if (f.issuedAt >= newestShot.issuedAt) { superseded.push(newestShot); newestShot = f }
      else superseded.push(f)
    } else {
      rest.push(f)
    }
  }
  const toRun = newestShot ? [...rest, newestShot] : [...rest]
  toRun.sort((a, b) => commandPriority(a.action) - commandPriority(b.action) || a.issuedAt - b.issuedAt)
  return { toRun, superseded }
}
