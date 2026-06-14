import { FleetStore } from '../fleet-store'
import { createProvider, type DeviceProvider } from '../provider'
import { HEARTBEAT_TIMEOUT_MS } from '../../../src/shared/heartbeat'

/** How often each active team sweeps for devices that have gone silent. */
const HEARTBEAT_SWEEP_MS = 5_000

/**
 * Per-tenant fleet engines. Each team gets its OWN in-memory FleetStore +
 * device provider + simulation loop, so a team's data, simulation, and live
 * broadcast are fully isolated — there is no shared mutable state across
 * tenants. Engines are created lazily on first access and their simulation loop
 * runs only while the team has at least one live WebSocket subscriber (so idle
 * tenants cost nothing).
 */
export interface TeamEngine {
  teamId: string
  store: FleetStore
  provider: DeviceProvider
  subscribers: number
  /** Interval that flips silent devices offline; runs only while subscribed. */
  heartbeatMonitor: ReturnType<typeof setInterval> | null
}

export class EngineRegistry {
  private engines = new Map<string, TeamEngine>()
  private pending = new Map<string, Promise<TeamEngine>>()

  /** Get (or lazily create + load) the engine for a team. */
  async get(teamId: string): Promise<TeamEngine> {
    const existing = this.engines.get(teamId)
    if (existing) return existing
    const inflight = this.pending.get(teamId)
    if (inflight) return inflight

    const promise = (async () => {
      const store = new FleetStore(teamId)
      await store.init() // loads (or seeds) ONLY this team's rows
      const provider = createProvider(store)
      const engine: TeamEngine = { teamId, store, provider, subscribers: 0, heartbeatMonitor: null }
      this.engines.set(teamId, engine)
      this.pending.delete(teamId)
      return engine
    })()
    this.pending.set(teamId, promise)
    return promise
  }

  /** Ref-count a live subscriber (WS). On the first one, start the sim loop AND
   *  the heartbeat-staleness monitor; both cost nothing while idle. */
  addSubscriber(engine: TeamEngine): void {
    engine.subscribers++
    if (engine.subscribers === 1) {
      engine.provider.startLoop?.()
      engine.heartbeatMonitor ??= setInterval(() => {
        engine.store.sweepStaleHeartbeats(Date.now(), HEARTBEAT_TIMEOUT_MS)
      }, HEARTBEAT_SWEEP_MS)
    }
  }

  /** Drop a subscriber. Stops the sim loop + staleness monitor when the last
   *  one leaves. */
  removeSubscriber(engine: TeamEngine): void {
    engine.subscribers = Math.max(0, engine.subscribers - 1)
    if (engine.subscribers === 0) {
      engine.provider.stopLoop?.()
      if (engine.heartbeatMonitor) {
        clearInterval(engine.heartbeatMonitor)
        engine.heartbeatMonitor = null
      }
    }
  }

  all(): TeamEngine[] {
    return [...this.engines.values()]
  }

  dispose(): void {
    for (const e of this.engines.values()) {
      e.provider.stopLoop?.()
      if (e.heartbeatMonitor) { clearInterval(e.heartbeatMonitor); e.heartbeatMonitor = null }
      e.store.dispose()
    }
    this.engines.clear()
  }
}
