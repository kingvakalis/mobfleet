import type { JsonWebKey } from 'node:crypto'

/**
 * Tiny JWKS cache for RS256 (Clerk). Fetches the provider's public keys and
 * caches them for `ttlMs`; on a `kid` miss it refetches once (key rotation).
 */
interface CacheEntry {
  keys: JsonWebKey[]
  fetchedAt: number
}

const cache = new Map<string, CacheEntry>()
const TTL_MS = 10 * 60 * 1000

async function fetchKeys(url: string): Promise<JsonWebKey[]> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`JWKS fetch failed: HTTP ${res.status}`)
  const body = (await res.json()) as { keys?: JsonWebKey[] }
  if (!Array.isArray(body.keys)) throw new Error('JWKS response missing keys[]')
  return body.keys
}

export async function getJwks(url: string, opts: { forceRefresh?: boolean; nowMs?: number } = {}): Promise<JsonWebKey[]> {
  const now = opts.nowMs ?? Date.now()
  const hit = cache.get(url)
  if (!opts.forceRefresh && hit && now - hit.fetchedAt < TTL_MS) return hit.keys
  const keys = await fetchKeys(url)
  cache.set(url, { keys, fetchedAt: now })
  return keys
}
