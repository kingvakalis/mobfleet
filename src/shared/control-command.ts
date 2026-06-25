/**
 * SHARED, pure helpers for the typed control-command surface. Alias-free (no
 * `@/`) so the Node server imports it directly. No DOM / env / side effects —
 * unit-testable in plain Node.
 *
 *  - controlCommandToWire(): maps a strict ControlCommand to the existing
 *    {deviceId, action, payload} agent-command wire format. This is what keeps
 *    the typed UI layer on the SAME durable queue (POST /v1/agent/command) — no
 *    second command channel.
 *  - formatCommandLog(): the single source of truth for the human-readable log
 *    line, so the server broadcast and the mock provider never drift. Typed text
 *    is reduced to a character count — the text itself is never logged.
 */
import type { AgentCommandAction, ControlCommand } from './types'
import { clampQualityLevel } from './stream-quality'

/** The wire shape consumed by POST /v1/agent/command (unchanged contract). */
export interface AgentCommandWire {
  deviceId: string
  action: AgentCommandAction
  payload?: Record<string, unknown>
}

/** Map a strict ControlCommand to the agent-command wire format. */
export function controlCommandToWire(command: ControlCommand): AgentCommandWire {
  switch (command.type) {
    case 'tap':
      return { deviceId: command.deviceId, action: 'tap', payload: { x: command.x, y: command.y } }
    case 'swipe':
      return {
        deviceId: command.deviceId,
        action: 'swipe',
        // The existing agent executes a directional `mobile: swipe {dir}`. Optional start/end
        // LOGICAL coordinates + duration from a real screen drag ride along (payload extra keys
        // are tolerated) for logs + a future coordinate-aware (dragFromToForDuration) agent;
        // `scroll` marks a scroll-mode drag (still a directional swipe on iOS).
        payload: {
          dir: command.dir,
          ...(command.x1 != null && command.y1 != null && command.x2 != null && command.y2 != null
            ? { x1: command.x1, y1: command.y1, x2: command.x2, y2: command.y2 }
            : {}),
          ...(command.durationMs != null ? { durationMs: command.durationMs } : {}),
          ...(command.scroll ? { scroll: true } : {}),
        },
      }
    case 'key':
      // home | back | lock | switcher are themselves top-level wire actions.
      return { deviceId: command.deviceId, action: command.key }
    case 'launch_app':
      return { deviceId: command.deviceId, action: 'launch', payload: { appName: command.appName } }
    case 'screenshot':
      // Carry the 0–30 quality LEVEL so the agent encodes this frame at the requested fidelity
      // (clamped here too — defense in depth). Omitted → the agent keeps its startup config.
      return {
        deviceId: command.deviceId,
        action: 'screenshot',
        payload: command.quality != null ? { quality: clampQualityLevel(command.quality) } : {},
      }
    case 'type_text':
      return { deviceId: command.deviceId, action: 'type', payload: { text: command.text } }
  }
}

/** Best-effort ControlCommand['type'] for a wire action (for log metadata).
 *  reboot/install have no ControlCommand counterpart → undefined. */
export function commandTypeForAction(action: AgentCommandAction): ControlCommand['type'] | undefined {
  switch (action) {
    case 'tap': return 'tap'
    case 'swipe': return 'swipe'
    case 'home': case 'back': case 'lock': case 'switcher': return 'key'
    case 'launch': return 'launch_app'
    case 'screenshot': return 'screenshot'
    case 'type': return 'type_text'
    default: return undefined // unlock / reboot / install
  }
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/**
 * Human-readable log line for a queued command. Operates on the wire shape so
 * the server (which has {action, payload}) and the client share one formatter.
 * SECURITY: `type` logs only the character count — never the typed text.
 */
export function formatCommandLog(action: AgentCommandAction, payload?: Record<string, unknown>): string {
  const p = payload ?? {}
  switch (action) {
    case 'tap': {
      const x = num(p.x), y = num(p.y)
      return x !== null && y !== null ? `Tap at ${Math.round(x)}, ${Math.round(y)}` : 'Tap'
    }
    case 'swipe': {
      const dir = str(p.dir)
      return dir ? `Swipe ${dir}` : 'Swipe'
    }
    case 'type': {
      const text = str(p.text)
      const n = text ? text.length : 0
      return `Typed ${n} character${n === 1 ? '' : 's'}`
    }
    case 'launch': {
      const appName = str(p.appName) ?? str(p.bundleId)
      return appName ? `Opened app: ${appName}` : 'Opened app'
    }
    case 'terminate': {
      const bundleId = str(p.bundleId)
      return bundleId ? `Closed app: ${bundleId}` : 'Closed app'
    }
    case 'refresh_apps': return 'Refreshed installed apps'
    case 'home': return 'Pressed Home'
    case 'back': return 'Pressed Back'
    case 'switcher': return 'Opened app switcher'
    case 'lock': return 'Locked device'
    case 'unlock': return 'Unlocked device'
    case 'screenshot': return 'Screenshot requested'
    case 'reboot': return 'Reboot requested'
    case 'install': return 'Install requested'
  }
}
