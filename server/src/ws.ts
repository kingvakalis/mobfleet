import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import type { FleetStore } from './fleet-store'

/**
 * Live feed: one WebSocket per browser tab at GET /ws. Sends a full snapshot on
 * connect and on every fleet change (matching the client's getSnapshot shape).
 * Heartbeat ping keeps proxies/hosts from dropping idle sockets.
 *
 * NOTE: CORS does not apply to WS upgrades — validate Origin here. (Auth on the
 * upgrade via session cookie is added with the auth layer.)
 */
export function registerWs(app: FastifyInstance, store: FleetStore, allowedOrigin: string) {
  let seq = 0

  const send = (socket: WebSocket) => {
    if (socket.readyState !== socket.OPEN) return
    socket.send(JSON.stringify({ type: 'snapshot', seq: ++seq, payload: store.snapshot() }))
  }

  // Broadcast to every connected client on any fleet change.
  store.onChange(() => {
    for (const client of app.websocketServer.clients) send(client as unknown as WebSocket)
  })

  app.get('/ws', { websocket: true }, (socket, req) => {
    const origin = req.headers.origin
    if (allowedOrigin !== '*' && origin && origin !== allowedOrigin) {
      socket.close(1008, 'origin not allowed')
      return
    }
    send(socket) // initial snapshot
    const ping = setInterval(() => {
      if (socket.readyState === socket.OPEN) socket.ping()
    }, 30_000)
    socket.on('close', () => clearInterval(ping))
    socket.on('error', () => clearInterval(ping))
  })
}
