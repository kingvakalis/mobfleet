/**
 * Tiny in-memory fixed-window rate limiter — no external deps. Used to throttle
 * the public device-claim endpoint (per client IP) and pairing-token minting
 * (per team). Good enough for a single-process server; front it with an edge/CDN
 * limiter for multi-instance production.
 */
type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()
const MAX_BUCKETS = 50_000 // backstop so the map itself can't grow unbounded

/** Returns true if the action is allowed (and records it), false if over limit. */
export function rateLimit(key: string, max: number, windowMs: number, now: number = Date.now()): boolean {
  const b = buckets.get(key)
  if (!b || now >= b.resetAt) {
    if (buckets.size >= MAX_BUCKETS) {
      // Prune expired entries before inserting (cheap amortized cleanup).
      for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k)
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (b.count >= max) return false
  b.count++
  return true
}

/** Test/maintenance helper. */
export function _resetRateLimits(): void {
  buckets.clear()
}
