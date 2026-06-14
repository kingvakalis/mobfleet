import type { Automation, Device, FleetSnapshot, Heartbeat, Job, Proxy } from '../../src/shared/types'
import { mergeHeartbeat, staleHeartbeatDevices } from '../../src/shared/heartbeat'
import { repo } from './repo'
import { seedFleet } from './seed'

/**
 * The authoritative fleet state for ONE team. In-memory maps are the source of
 * truth for fast reads + WS broadcast; mutations write through to the DB
 * (debounced, team-scoped) and notify listeners (the WS layer). `runBatch`
 * coalesces many mutations from a simulation tick into a single change.
 *
 * One FleetStore exists per tenant (see tenancy/engine-registry.ts). Because
 * the store only ever holds its own team's rows and persists via the
 * teamId-scoped repo, cross-tenant leakage is impossible by construction.
 */
export class FleetStore {
  private devices = new Map<string, Device>()
  private jobs = new Map<string, Job>()
  private proxies = new Map<string, Proxy>()
  private automations = new Map<string, Automation>()
  ready = false

  private listeners = new Set<() => void>()
  private batching = false
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  /** deviceId → time of the last EXTERNAL (real agent) heartbeat. Lets the
   *  simulator defer to real agents instead of faking their telemetry. */
  private externalHeartbeats = new Map<string, number>()

  constructor(public readonly teamId: string) {}

  async init(): Promise<void> {
    const data = await repo.load(this.teamId)
    if (data.devices.length === 0) {
      const seeded = seedFleet()
      seeded.devices.forEach((d) => this.devices.set(d.id, d))
      seeded.jobs.forEach((j) => this.jobs.set(j.id, j))
      seeded.proxies.forEach((p) => this.proxies.set(p.ip, p))
      seeded.automations.forEach((a) => this.automations.set(a.id, a))
      await repo.persist(this.teamId, this.persistData())
    } else {
      data.devices.forEach((d) => this.devices.set(d.id, d))
      data.jobs.forEach((j) => this.jobs.set(j.id, j))
      data.proxies.forEach((p) => this.proxies.set(p.ip, p))
      data.automations.forEach((a) => this.automations.set(a.id, a))
    }
    // Backfill automations for DBs created before the feature existed.
    if (this.automations.size === 0) {
      seedFleet().automations.forEach((a) => this.automations.set(a.id, a))
      await repo.persist(this.teamId, this.persistData())
    }
    this.ready = true
  }

  private persistData() {
    return { ...this.raw(), automations: [...this.automations.values()] }
  }

  // --- reads ---
  raw() {
    return { devices: [...this.devices.values()], jobs: [...this.jobs.values()], proxies: [...this.proxies.values()] }
  }
  snapshot(): FleetSnapshot {
    return { ...this.raw(), ts: Date.now(), ready: this.ready }
  }
  listDevices() { return [...this.devices.values()] }
  listJobs() { return [...this.jobs.values()] }
  listProxies() { return [...this.proxies.values()] }
  listAutomations() { return [...this.automations.values()] }
  getDevice(id: string) { return this.devices.get(id) }
  getJob(id: string) { return this.jobs.get(id) }
  getProxy(ip: string) { return this.proxies.get(ip) }
  findProxyForDevice(id: string) { return [...this.proxies.values()].find((p) => p.assignedTo === id) }
  spareProxy() { return [...this.proxies.values()].find((p) => p.status === 'unassigned') }

  // --- writes (each notifies unless inside runBatch) ---
  putDevice(d: Device) { this.devices.set(d.id, d); this.changed() }
  removeDevice(id: string) { this.devices.delete(id); this.changed() }
  putJob(j: Job) { this.jobs.set(j.id, j); this.changed() }
  removeJob(id: string) { this.jobs.delete(id); this.changed() }
  putProxy(p: Proxy) { this.proxies.set(p.ip, p); this.changed() }
  setReady(v: boolean) { this.ready = v; this.changed() }

  /** Record an automation run by its name (the job's task label). Persist-only,
   *  no WS broadcast (automations aren't part of the live snapshot). */
  bumpAutomationRun(name: string) {
    const a = [...this.automations.values()].find((x) => x.name === name)
    if (!a) return
    this.automations.set(a.id, { ...a, runs: a.runs + 1, lastRun: 'just now' })
    this.scheduleSave()
  }

  // --- heartbeats ---
  /**
   * Merge a device heartbeat (status + telemetry, stamped with the receipt
   * time) and broadcast/persist via the normal putDevice path. Returns false
   * when the device isn't in THIS team's store — the caller's WS connection is
   * already team-scoped, so this is the tenant guard: a client can only ever
   * heartbeat its own team's devices.
   */
  applyHeartbeat(hb: Heartbeat, now: number): boolean {
    const dev = this.devices.get(hb.deviceId)
    if (!dev) return false
    this.externalHeartbeats.set(hb.deviceId, now)
    this.putDevice(mergeHeartbeat(dev, hb, now))
    return true
  }

  /** True when a real agent has heartbeat this device within `ttlMs` — the
   *  simulator checks this and won't fake telemetry for an agent-owned device,
   *  so when that agent goes silent the staleness sweep can take it offline. */
  hasRecentExternalHeartbeat(id: string, now: number, ttlMs: number): boolean {
    const t = this.externalHeartbeats.get(id)
    return t != null && now - t <= ttlMs
  }

  /**
   * Flip agent-managed devices that have gone silent past `timeoutMs` to
   * offline, in a single batched broadcast. Returns the number flipped — 0
   * means nothing was stale, so no broadcast/persist is triggered.
   */
  sweepStaleHeartbeats(now: number, timeoutMs: number): number {
    const stale = staleHeartbeatDevices([...this.devices.values()], now, timeoutMs)
    if (stale.length === 0) return 0
    this.runBatch(() => {
      for (const d of stale) this.putDevice({ ...d, status: 'offline', jobId: null })
    })
    return stale.length
  }

  /** Apply many mutations, emit a single change at the end. */
  runBatch(fn: () => void) {
    this.batching = true
    try { fn() } finally {
      this.batching = false
      this.changed()
    }
  }

  // --- change plumbing ---
  onChange(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private changed() {
    if (this.batching) return
    this.listeners.forEach((l) => l())
    this.scheduleSave()
  }
  private scheduleSave() {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      repo.persist(this.teamId, this.persistData()).catch((e) => console.error('[persist]', this.teamId, e))
    }, 800)
  }

  /** Release timers/listeners (registry eviction). */
  dispose() {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null }
    this.listeners.clear()
  }
}
