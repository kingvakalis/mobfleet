import { FleetStore } from '../fleet-store'
import { createProvider, type DeviceProvider } from '../provider'

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
      const engine: TeamEngine = { teamId, store, provider, subscribers: 0 }
      this.engines.set(teamId, engine)
      this.pending.delete(teamId)
      return engine
    })()
    this.pending.set(teamId, promise)
    return promise
  }

  /** Ref-count a live subscriber (WS). Starts the sim loop on the first one. */
  addSubscriber(engine: TeamEngine): void {
    engine.subscribers++
    if (engine.subscribers === 1) engine.provider.startLoop?.()
  }

  /** Drop a subscriber. Stops the sim loop when the last one leaves. */
  removeSubscriber(engine: TeamEngine): void {
    engine.subscribers = Math.max(0, engine.subscribers - 1)
    if (engine.subscribers === 0) engine.provider.stopLoop?.()
  }

  all(): TeamEngine[] {
    return [...this.engines.values()]
  }

  dispose(): void {
    for (const e of this.engines.values()) {
      e.provider.stopLoop?.()
      e.store.dispose()
    }
    this.engines.clear()
  }
}
