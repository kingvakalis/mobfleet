/**
 * Live device-socket registry. When a device agent connects its heartbeat
 * WebSocket (ws.ts → registerDeviceSocket), it registers a sender here keyed by
 * (teamId, deviceId). POST /v1/agent/command uses pushToDevice() to deliver a
 * queued command instantly over that socket (the hybrid push path), falling back
 * to the agent's HTTP poll when no socket is live. In-memory + single-process —
 * acceptable because the WS itself is single-process; the durable queue
 * (AgentCommand rows) is the source of truth, this is just a low-latency fast path.
 *
 * ONE sender per device: a device is one agent identity (one API key). On a
 * reconnect (incl. half-open TCP where the old socket hasn't closed yet) the new
 * registration EVICTS the previous socket via its close() callback, so commands
 * are never pushed to a superseded socket (which would falsely report delivery and
 * strand the command). Pair with pong/terminate liveness in ws.ts.
 */

/** Returns true only if the frame was actually written to the socket (false when
 *  the socket is closing or backpressured — so the caller doesn't mark a command
 *  delivered that never went out; the agent's HTTP poll then picks it up). */
type Sender = (frame: unknown) => boolean

interface Entry {
  send: Sender
  /** Terminate the underlying socket (used to evict a superseded connection). */
  close: () => void
}

const entries = new Map<string, Entry>()
const keyOf = (teamId: string, deviceId: string) => `${teamId}:${deviceId}`

/**
 * Register the live socket for a device, evicting any prior socket for the same
 * (teamId, deviceId). Returns an unregister to call from the socket's cleanup; it
 * only removes the entry if THIS socket is still the current one (so evicting an
 * old socket, which triggers its own cleanup, can't delete the new registration).
 */
export function registerDeviceSender(teamId: string, deviceId: string, send: Sender, close: () => void): () => void {
  const k = keyOf(teamId, deviceId)
  const prev = entries.get(k)
  const entry: Entry = { send, close }
  entries.set(k, entry)
  if (prev) {
    try {
      prev.close() // evict the superseded (possibly half-open) socket
    } catch {
      /* already gone */
    }
  }
  return () => {
    if (entries.get(k) === entry) entries.delete(k)
  }
}

/** Push a frame to the live socket for (teamId, deviceId). Returns true only if it
 *  was actually written (the sender guards readyState + backpressure). */
export function pushToDevice(teamId: string, deviceId: string, frame: unknown): boolean {
  const entry = entries.get(keyOf(teamId, deviceId))
  if (!entry) return false
  try {
    return entry.send(frame)
  } catch {
    return false
  }
}
