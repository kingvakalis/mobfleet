# MobFleet MJPEG Stream Relay (Stage 2A)

Small authenticated relay that bridges the Mac agent's local WDA MJPEG to browsers, so live video
**never touches Postgres** and the raw `127.0.0.1:9100` is **never exposed**.

```
Mac agent ──outbound WSS /publish?key=<device-key>──▶ [relay] ──HTTP multipart /stream/:id?t=<token>──▶ browser <img>
```

- **Publisher (agent):** `wss://<relay>/publish?key=<device-key>` — one **binary** WS message per JPEG
  frame. The relay authenticates the key via `resolve_stream_publisher` (Supabase RPC, anon key).
- **Viewer (browser):** `GET https://<relay>/stream/<deviceId>?t=<token>` → `multipart/x-mixed-replace`.
  The relay validates the short-lived, device-scoped token via `redeem_stream_token`. A token for one
  device cannot view another.
- **Fan-out + de-dupe:** one publisher → N viewers; identical frames are skipped (static screen → no
  re-send); a new viewer immediately gets the latest frame.

## Run / deploy
```bash
cd relay && npm install
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_ANON_KEY=<anon> \
PORT=8090 \
npm start
```
Terminate **TLS at the host/ingress** (fly.io, a small VM + Caddy/Nginx, etc.) so the browser sees
`https://`/`wss://` (mobfleet.co is HTTPS → a raw `http://` MJPEG `<img>` is mixed-content-blocked).
Point the frontend at it with `VITE_STREAM_RELAY_URL=https://<relay-host>`.

This service is **NOT** the Railway `/v1/devices` backend and shares nothing with it. It holds only the
**anon** key (no service-role). Video is in memory only — nothing persisted.

## Deploy (Docker / fly.io)
A `Dockerfile` + `fly.toml` are included. fly terminates TLS and proxies **both** the HTTP `/stream`
multipart and the `wss` `/publish` upgrade over one port (`force_https`), so the browser gets
`https://` + `wss://` (required — `mobfleet.co` is HTTPS).

```bash
cd relay
fly launch --no-deploy --name mobfleet-stream-relay     # first time (or reuse the committed fly.toml)
fly secrets set SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon-key>
fly deploy
```
The relay is then at `https://mobfleet-stream-relay.fly.dev`. Point the frontend's
`VITE_STREAM_RELAY_URL` at it and hand the Mac `wss://mobfleet-stream-relay.fly.dev/publish`. Any host
works (Render / a VM + Caddy / Docker anywhere) as long as it serves **HTTPS + WSS** and sets the two
secrets. **No service-role key** — only the anon key. Health check: `GET /health` → `200 ok`.

## Env
| var | default | meaning |
|---|---|---|
| `PORT` | 8090 | listen port |
| `SUPABASE_URL` | — | project URL (for the auth RPCs) |
| `SUPABASE_ANON_KEY` | — | anon key (RPC auth; no service-role) |
| `ALLOW_ORIGIN` | `*` | CORS origin for `/stream` |

## Tests
`npm test` runs the pure unit tests (`hub`, `multipart`). The end-to-end (agent → relay → browser)
requires the Mac agent + a deployed relay.
