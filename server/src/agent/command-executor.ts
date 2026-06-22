/**
 * Translates a queued AgentCommandFrame into an adapter call, executes it against
 * the device, and produces a CommandResultBody for the ACK path.
 *
 * Two invariants the control plane relies on:
 *   1. IDEMPOTENT EXECUTION — the durable queue may re-deliver a command (lost WS
 *      push, agent restart mid-flight, dual WS+HTTP delivery). We dedup by
 *      commandId: a command already executing or terminal is NEVER run twice; the
 *      cached result is returned so the ACK is consistent. This is the agent half
 *      of the server's own dedup (ackCommand 'noop').
 *   2. SECRET-FREE RESULTS — a thrown error becomes a structured
 *      {code,message,retryable}; we never put the raw payload (e.g. typed text),
 *      stack traces, or device keys into the result.
 *
 * Pure of network/OS: it depends only on the DeviceControlAdapter interface, so
 * it's exercised with the simulated adapter in unit tests.
 */
import type { DeviceControlAdapter, AdapterCommand } from './device-adapter'
import type { AgentCommandFrame, ExecResult } from './types'
import type { AgentCommandAction } from '../../../src/shared/schemas'

/** Per-command execution state for dedup. */
type Entry =
  | { state: 'running'; promise: Promise<ExecResult> }
  | { state: 'done'; result: ExecResult }

/** Map a queued action + payload to the adapter's typed command. Returns null
 *  when the payload is malformed for that action (defense in depth — the server
 *  already validated it, but the agent must not trust the queue blindly). */
export function toAdapterCommand(action: AgentCommandAction, payload: unknown): AdapterCommand | null {
  const p = (payload ?? {}) as Record<string, unknown>
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  switch (action) {
    case 'screenshot': return { kind: 'screenshot' }
    case 'home': return { kind: 'home' }
    case 'back': return { kind: 'back' }
    case 'switcher': return { kind: 'switcher' }
    case 'lock': return { kind: 'lock' }
    case 'unlock': return { kind: 'unlock' }
    case 'reboot': return { kind: 'reboot' }
    case 'tap': {
      const x = num(p.x), y = num(p.y)
      return x !== null && y !== null ? { kind: 'tap', x, y } : null
    }
    case 'swipe': {
      const dir = p.dir
      return dir === 'up' || dir === 'down' || dir === 'left' || dir === 'right' ? { kind: 'swipe', dir } : null
    }
    case 'type': {
      const text = p.text
      return typeof text === 'string' && text.length > 0 ? { kind: 'type', text } : null
    }
    case 'launch': {
      const bundleId = typeof p.bundleId === 'string' && p.bundleId.trim().length > 0 ? p.bundleId : undefined
      const appName = typeof p.appName === 'string' && p.appName.trim().length > 0 ? p.appName : undefined
      if (!bundleId && !appName) return null
      // Omit absent keys (no `bundleId: undefined`) so the AdapterCommand stays a clean object.
      return { kind: 'launch', ...(bundleId ? { bundleId } : {}), ...(appName ? { appName } : {}) }
    }
    case 'terminate': {
      const bundleId = p.bundleId
      return typeof bundleId === 'string' && bundleId.trim().length > 0 ? { kind: 'terminate', bundleId } : null
    }
    case 'install': {
      const appName = typeof p.appName === 'string' ? p.appName : undefined
      return { kind: 'install', appName }
    }
    default: return null
  }
}

/** Pull a safe error code/message off any thrown value (no stacks, no payload). */
function describeError(err: unknown): { code: string; message: string } {
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; message?: unknown }
    const code = typeof e.code === 'string' ? e.code : 'EXEC_FAILED'
    const message = typeof e.message === 'string' ? e.message : 'command execution failed'
    return { code, message: message.slice(0, 2000) }
  }
  return { code: 'EXEC_FAILED', message: 'command execution failed' }
}

export class CommandExecutor {
  private readonly seen = new Map<string, Entry>()

  constructor(private readonly adapter: DeviceControlAdapter) {}

  /** True if this commandId has already been executed (or is in flight). */
  hasSeen(commandId: string): boolean {
    return this.seen.has(commandId)
  }

  /**
   * Execute a command for a UDID, deduped by commandId. A repeat of an in-flight
   * command awaits the SAME promise; a repeat of a finished command returns the
   * cached result — so a re-delivered command never double-taps the phone.
   */
  async execute(udid: string, frame: AgentCommandFrame): Promise<ExecResult> {
    const prior = this.seen.get(frame.commandId)
    if (prior) return prior.state === 'running' ? prior.promise : prior.result

    const promise = this.run(udid, frame)
    this.seen.set(frame.commandId, { state: 'running', promise })
    const result = await promise
    this.seen.set(frame.commandId, { state: 'done', result })
    return result
  }

  private async run(udid: string, frame: AgentCommandFrame): Promise<ExecResult> {
    const startedAt = Date.now()
    const fail = (code: string, message: string, retryable: boolean): ExecResult => ({
      success: false,
      startedAt,
      completedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      error: { code, message, retryable },
    })

    const command = toAdapterCommand(frame.action, frame.payload)
    if (!command) return fail('BAD_PAYLOAD', `unsupported or malformed payload for ${frame.action}`, false)

    // WDA must be healthy before any gesture; surface a retryable error if not so
    // the operator (or a retry) can recover after WDA restarts.
    try {
      if (!(await this.adapter.isWdaHealthy(udid))) {
        return fail('WDA_UNHEALTHY', 'WebDriverAgent is not healthy for this device', true)
      }
    } catch (err) {
      const { code, message } = describeError(err)
      return fail(code, message, true)
    }

    try {
      const outcome = await this.adapter.execute(udid, command)
      return {
        success: true,
        startedAt,
        completedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        result: outcome.result,
      }
    } catch (err) {
      const { code, message } = describeError(err)
      // Treat unknown execution failures as retryable (the WDA may recover);
      // a structural BAD_PAYLOAD above is the only non-retryable class.
      return fail(code, message, true)
    }
  }

  /** Drop dedup memory for commands older than ttlMs so the map can't grow
   *  unbounded over a long-lived agent. Only finished entries are evicted. */
  prune(commandIds: Iterable<string>): void {
    for (const id of commandIds) {
      const e = this.seen.get(id)
      if (e && e.state === 'done') this.seen.delete(id)
    }
  }
}
