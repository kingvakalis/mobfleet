/**
 * Mac-Mini hardware-agent types. The agent is a long-running daemon on a macOS
 * host that owns one or more USB-attached iPhones. It authenticates to the
 * control plane with a per-device API key (DeviceApiKey, minted at claim time),
 * receives commands over the durable AgentCommand queue (WS push + HTTP poll),
 * executes them against the real device through WebDriverAgent (WDA) over USB,
 * and ACKs a CommandResultBody.
 *
 * Everything here is alias-free (no `@/`) so the Node agent compiles + runs under
 * tsx without the Vite path alias, exactly like the rest of the server.
 */
import type { AgentCommandAction, CommandResultBody } from '../../../src/shared/schemas'

/** The agent's own semantic version — reported on connect (DeviceSession.agentVersion)
 *  so the dashboard can see which build a device is running and gate rollouts. */
export const AGENT_VERSION = '1.0.0'

/** A queued command as the agent receives it (the server's CommandFrame shape). */
export interface AgentCommandFrame {
  type: 'command'
  commandId: string
  deviceId: string
  action: AgentCommandAction
  payload?: unknown
  issuedAt: number
  expiresAt?: number
}

/** Stable hardware identity discovered over USB. `udid` is the durable key the
 *  control plane reconnects a device by — it survives reboots, agent restarts,
 *  and cable re-plugs. The rest is telemetry shown in the dashboard. */
export interface DeviceIdentity {
  udid: string
  name: string
  model: string
  /** e.g. "iOS 18.2" — normalized to the heartbeat/claim format. */
  osVersion: string
  platform: 'ios'
}

/** Live device telemetry sampled for each heartbeat. */
export interface DeviceTelemetry {
  /** 0–100, or null when unreadable. */
  battery: number | null
  /** 0–100, or null. */
  cpuUsage: number | null
  /** 0–100, or null. */
  memoryUsage: number | null
}

/** A device the agent currently manages: its stable identity + the WDA endpoint
 *  the agent started for it (host-local; never exposed off the Mac Mini). */
export interface ManagedDevice {
  identity: DeviceIdentity
  /** The dynamically assigned local WDA port (see WdaPortAllocator). */
  wdaPort: number
  /** WDA health — false until the agent confirms /status returns ok. */
  wdaReady: boolean
}

/** Result of executing one command against the device. Mirrors the wire
 *  CommandResultBody so the executor can return it straight to the ACK path. */
export type ExecResult = CommandResultBody

/** A discrete error the executor can surface without leaking internals. */
export interface ExecError {
  code: string
  message: string
  retryable: boolean
}
