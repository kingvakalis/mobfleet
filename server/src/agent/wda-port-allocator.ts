/**
 * Dynamic, collision-free WebDriverAgent port assignment for a multi-device Mac
 * Mini. Each managed device gets ONE stable local port for its WDA HTTP server.
 *
 *  - allocate(udid): returns the SAME port for a UDID across calls (stable
 *    identity → stable port, so a reconnect of the same device reuses its port).
 *  - release(udid): frees the port when a device disconnects, so it can be
 *    reused by a future device without unbounded growth.
 *
 * Pure + in-memory + deterministic → unit-testable with no OS calls.
 */
export class WdaPortAllocator {
  private readonly base: number
  private readonly max: number
  private readonly byUdid = new Map<string, number>()
  private readonly used = new Set<number>()

  /** Default WDA range 8100–8199 (one Mac Mini won't host 100+ phones). */
  constructor(base = 8100, count = 100) {
    this.base = base
    this.max = base + count - 1
  }

  /** The port currently assigned to a UDID, or undefined if none. */
  portFor(udid: string): number | undefined {
    return this.byUdid.get(udid)
  }

  /**
   * Assign a port to a UDID. Stable: the same UDID always gets the same port
   * until released. Throws when the range is exhausted (a clear operational
   * signal rather than a silent collision).
   */
  allocate(udid: string): number {
    const existing = this.byUdid.get(udid)
    if (existing !== undefined) return existing
    for (let port = this.base; port <= this.max; port++) {
      if (!this.used.has(port)) {
        this.used.add(port)
        this.byUdid.set(udid, port)
        return port
      }
    }
    throw new Error(`WDA port range exhausted (${this.base}-${this.max})`)
  }

  /** Free a UDID's port (on disconnect). Idempotent. */
  release(udid: string): void {
    const port = this.byUdid.get(udid)
    if (port === undefined) return
    this.byUdid.delete(udid)
    this.used.delete(port)
  }

  /** Number of currently allocated ports (for diagnostics/tests). */
  get size(): number {
    return this.byUdid.size
  }
}
