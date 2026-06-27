# Stage 2A — Production MJPEG Live Streaming Plan

> Status: **frontend `streamUrl` plumbing landed** (this commit, behind a null-by-default resolver → production no-op). Agent + relay + token are the remaining, Mac/infra-side work specified below. **No WebRTC. No deploy until approved.**

## Spike result (Mac, confirmed)
- WDA MJPEG already reachable at `127.0.0.1:9100` on the Mac.
- **~8.9 fps, 1170×2532, ~6.57 Mbps**, stable on Mainlucia.
- The screenshot-row GO LIVE path (~1–2 fps, ~1.5–3 s glass-to-glass) is the bottleneck → it becomes **fallback only**. Manual Screenshot stays the existing high-quality screenshot command.

## Architecture (no video in Postgres; local port never exposed)
```
iPhone WDA MJPEG :9100 ──usb──> Mac agent ──outbound WSS──> hosted relay ──WSS/HTTPS──> browser
   (multipart/jpeg)            reads 127.0.0.1:9100,        validates per-device           renders in <img>
                               pushes frames OUT           stream token; fans out          (existing glass)
```
Supabase stays the source of **auth/team/device** truth and mints the access token; **frames never touch Supabase/Postgres**.

## 1. Agent (server/src/agent/* — the LIVE tree only; NOT phone-farm-app/agent/*)
- **Enable WDA MJPEG** by adding to the Appium session caps (`appium-device-adapter.ts:172-184`, or zero-code via `APPIUM_EXTRA_CAPS`):
  `appium:mjpegServerPort` (forwarded to the Mac host), `appium:mjpegServerFramerate` (≈15), `appium:mjpegServerScreenshotQuality` (≈25), `appium:mjpegScalingFactor` (≈50).
- **Per-device MJPEG reader**, started in `agent-runtime.ts` `bringUp()` and stopped in `tearDown()`, so it lives under the single managed `AgentRuntime` watchdog (NO second agent, NO `AGENT_DEVICES` change). It opens an **outbound WSS** to the relay (auth = the device's existing **device-key**), reads `http://127.0.0.1:<mjpegPort>`, and forwards frames. Env-gated (`PFA_MJPEG=1`) → off by default, reversible by config.
- **Mac confirm:** `agent.mode=appium`; that `mjpegServerPort` is auto-forwarded to the host (else add a managed `iproxy <hostPort> 9100`); whether `mjpegServerFramerate/quality` are changeable live via `POST /session/:id/appium/settings`.

## 2. Hosted relay (small dedicated service — NOT the Railway /v1/devices backend)
- Accepts the agent's outbound WSS (device-key auth) and browser viewers (stream-token auth).
- Validates the viewer's **short-lived, device-scoped** token, then fans the device's frames out to authorized viewers. Drops the socket on token expiry. Stateless w.r.t. video (no storage).
- HTTPS/WSS only (mobfleet.co is HTTPS → a raw `http://` MJPEG `<img>` is mixed-content-blocked).

## 3. Supabase stream token (metadata only — no video rows)
- `mint_stream_token(p_device_id)` RPC (or edge fn, mirroring `send-invite`): checks `is_team_member(team_of(device))` under the **operator's JWT**, returns `{ token, expires_at }` bound to `{team_id, device_id, exp≈60s}`. Mirrors `device_pairing_tokens` TTL + the device-recordings signed-URL pattern. **No service-role secret in the browser.**
- The relay verifies the token (shared secret / JWT) before serving a single device's frames; a token for device A cannot view B.

## 4. Frontend (DONE this commit — `streamUrl` plumbing, backward-compatible)
- `src/services/stream.ts` — `resolveDeviceStream({deviceId, teamId})` → `{ url, canControlSettings } | null`. Returns **null until the relay/RPC exist** (production no-op); a `localStorage['pfa:streamUrl[:<id>]']` override lets the Mac owner point at a tunnelled stream for testing. When the relay lands, this calls `mint_stream_token` and builds the relay URL.
- `live-phone.tsx` — new `streamUrl`/`onStreamLoad`/`onStreamError` props; in the `else if (frame)` glass branch it renders `<img src={streamUrl}>` (browser-native multipart decode) when a stream is set, else the base64 `<img>`. **Gesture math + `frame.width/height` dims are unchanged** → tap/swipe mapping identical over the stream.
- `phone-control-page.tsx` — `showStream`/`streamShowing` derived state; resolves a stream when GO LIVE turns on; **stands down the screenshot capture + display loops while the stream is showing frames**; falls back to screenshots on `onStreamError` or when no stream; ensures one frame exists for dims; STREAM chip tri-state (**Live MJPEG / Snapshot / Snap / Idle**); FRM shows `live`; FPS caption truthful (no 30-fps claim).

## 5. Quality/FPS truth
- Today the sliders drive the **screenshot fallback only** — shown explicitly ("snapshot fallback only") whenever a stream is live and `canControlSettings` is false.
- When the relay/agent expose live MJPEG settings, map: Quality → `mjpegServerScreenshotQuality` + `mjpegScalingFactor`; FPS → `mjpegServerFramerate` (via Appium `POST /session/:id/appium/settings`). Effective rate displayed from real frames, never claimed.

## 6. Fallback
MJPEG is strictly additive: no stream / token fail / WDA MJPEG off / CORS → `streamUrl` null → GO LIVE runs the **current screenshot-row path unchanged**. Manual Screenshot + Home/tap/swipe/Launch/Stop are untouched (command path).

## 7. Deploy sequence (when approved, staged, Mainlucia-first)
1. Stand up the relay (HTTPS/WSS) + `mint_stream_token` RPC (validate rolled-back).
2. Point `resolveDeviceStream` at the relay (frontend) behind a feature flag; deploy frontend.
3. Mac: add the `mjpeg*` caps + the `PFA_MJPEG=1` reader; restart the agent for **Mainlucia first**; verify fps/latency + that taps stay responsive (one WDA session serves screen + control).
4. Roll to the rest of the fleet.

## 8. Rollback
- Frontend: feature flag off / revert the small diff → screenshot path. No DB/migration.
- Agent: `PFA_MJPEG=0` (or drop the `mjpeg*` caps) + restart → WDA stops the MJPEG server.
- Relay: stop the service (nothing else depends on it). Token RPC is inert without the relay.

## 9. Files
- **Frontend (done):** `src/services/stream.ts` (new), `src/components/phone/live-phone.tsx`, `src/components/phone/phone-control-page.tsx`.
- **Agent (Mac-deploy):** `server/src/agent/appium-device-adapter.ts` (mjpeg caps) — or `APPIUM_EXTRA_CAPS`; `server/src/agent/agent-runtime.ts` (`bringUp/tearDown` reader, env-gated).
- **New:** hosted relay service; `mint_stream_token` RPC/edge fn (metadata only).

## Risks (carry-over from the spike report)
Coordinate-space mismatch (keep `frame.width/height` = the logical points the screenshot path used); silent gesture-drop if dims missing (the dims-ensure effect covers this); mixed-content/CORS (HTTPS relay); one WDA session serving screen+taps may add input latency (measure); Mac-availability gating for the source-enable + relay.
