/** HH:MM:SS from a duration in ms. */
export function formatUptime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

export function formatCost(n: number): string {
  return `$${n.toFixed(2)}`
}

/** Compact duration: 42s · 3m 05s · 1h 12m */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  return `${h}h ${String(m % 60).padStart(2, '0')}m`
}

/** Relative age: now · 12s · 4m · 2h ago */
export function formatRelative(ts: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000))
  if (s < 3) return 'now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ago`
}

/** Truncate a long id in the middle: ios-7f3a9c2e → ios-7f…c2e */
export function truncateId(id: string, head = 8, tail = 3): string {
  if (id.length <= head + tail + 1) return id
  return `${id.slice(0, head)}…${id.slice(-tail)}`
}

/** Uptime from a creation timestamp to now (kept here so render code stays pure). */
export function uptimeSince(createdAt: number): string {
  return formatUptime(Date.now() - createdAt)
}
