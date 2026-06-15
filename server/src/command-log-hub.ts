/**
 * Team-scoped command-log broadcast for BROWSER sockets. When a command is
 * queued (POST /v1/agent/command), the route calls broadcastCommandLog(teamId,
 * frame); every live browser socket for that team receives it over its EXISTING
 * /ws connection — the same socket that streams fleet snapshots, never a second
 * connection.
 *
 * Team isolation: subscribers are keyed by teamId, so one team's command logs
 * are never delivered to another tenant's operators. In-memory + single-process
 * (like device-hub.ts) — acceptable because the WS layer is single-process; the
 * durable AgentCommand rows remain the source of truth, this is just the live
 * operator echo.
 */
type Send = (frame: unknown) => void

const subscribers = new Map<string, Set<Send>>()

/**
 * Register a browser socket's sender for its team. Returns an unregister to call
 * from the socket's cleanup; drops the team's set once empty so it can't leak.
 */
export function registerBrowserLogSocket(teamId: string, send: Send): () => void {
  let set = subscribers.get(teamId)
  if (!set) {
    set = new Set()
    subscribers.set(teamId, set)
  }
  set.add(send)
  return () => {
    const s = subscribers.get(teamId)
    if (!s) return
    s.delete(send)
    if (s.size === 0) subscribers.delete(teamId)
  }
}

/** Broadcast a command-log frame to every live browser socket of ONE team. */
export function broadcastCommandLog(teamId: string, frame: unknown): void {
  const set = subscribers.get(teamId)
  if (!set) return
  for (const send of [...set]) {
    try {
      send(frame)
    } catch {
      /* one bad socket must not block delivery to the others */
    }
  }
}
