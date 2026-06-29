# Stage 2C — WebRTC Screen Stream (design; NOT built)

> Gated on the 2B-A measurements (`docs/stage2b-measurement.md`). Build only if MJPEG can't hit the
> glass-to-glass / fps targets. WebRTC becomes the **preferred** live mode; **MJPEG stays the fallback**;
> Snapshot stays the last-resort fallback. No video in Postgres; no raw `:9100`; no Railway `/v1/devices`.

## Why WebRTC over MJPEG (what it fixes)
MJPEG is whole-JPEG-per-frame over TCP: no inter-frame compression, no congestion control, head-of-line
blocking → bandwidth-heavy and latency grows under loss. WebRTC sends **H.264/VP8 over SRTP/UDP** with
real congestion control + a jitter buffer → 15–30 fps at a fraction of the bitrate and sub-300 ms when the
network allows. It is the right transport for "production-fast."

## Architecture
```
iPhone ──WDA MJPEG :9100 (USB)──> Mac agent ───────────────────────────────> browser
                                  ├ decode MJPEG → raw frames                RTCPeerConnection
                                  ├ H.264 encode (videotoolbox, HW)          <video> element
                                  └ WebRTC sender (pion/werift) ──SRTP/UDP──> (TURN relay if needed)
        signaling (SDP + ICE) over Supabase Realtime/RPC  ·  TURN creds via edge fn  ·  NO media in Supabase
```

### Mac agent (server/src/agent/*, the LIVE tree only)
- **Source:** reuse the existing local WDA MJPEG (`MjpegDemux` already yields JPEG frames) — *or* a native
  `mobile: startScreenStreaming` / AVFoundation capture if measurement shows MJPEG decode is the bottleneck.
- **Encoder:** decode JPEG → `h264_videotoolbox` (HW, low CPU on the Mac Mini) → an RTP video track. One
  encoder per active viewer-session (or one shared track fanned out by an SFU — see scaling).
- **WebRTC sender:** a Go **pion** sidecar (most mature for server-side send-only H.264) or `werift`
  (pure-Node, simpler to co-locate in the agent). Send-only; **latest-frame-first** is inherent (the encoder
  consumes the newest decoded frame; drop intermediates under pressure, exactly like the MJPEG hub).
- **Lifecycle:** started/stopped in `agent-runtime` `bringUp/tearDown`, env-gated `PFA_WEBRTC=1`. No second
  agent; no `AGENT_DEVICES` change. Falls back to publishing MJPEG when WebRTC can't establish.

### Signaling (Supabase only — metadata, never media)
- Reuse the **stream-token** model (`mint_stream_token` / `redeem_stream_token` / `resolve_stream_publisher`,
  migration 20260628140000). Add a tiny `webrtc_signaling` channel: SDP offer/answer + ICE candidates
  exchanged over a **Supabase Realtime** channel scoped by `{team, device}` RLS (or short rows in a
  `webrtc_signals` table, device-scoped, ~60 s TTL). Supabase carries **only** SDP/ICE — no frames.
- The browser mints a token (team-member RLS), opens the signaling channel for its device, and exchanges
  SDP/ICE with the agent (which authenticates by device-key, same as the relay publisher).

### NAT traversal — STUN + TURN
- STUN for the common case; a **TURN** server (coturn) is **required** for remote viewers (the Mac and the
  operator are rarely same-LAN). TURN credentials are short-lived, minted by an **edge function** (HMAC of
  `username:expiry` with the TURN secret) — never the raw secret in the browser.

### Browser (src/components/phone/*)
- New live mode: an `RTCPeerConnection` rendering into a `<video>` element instead of the MJPEG `<img>`.
- **Source selection:** `resolveDeviceStream` (today returns an MJPEG URL) gains a `kind: 'webrtc' | 'mjpeg'`.
  GO LIVE prefers WebRTC; on ICE failure / no TURN / timeout → fall back to the MJPEG `<img>` (the existing
  `streamUrl` path); on that failure → the screenshot Snapshot path. Same `streamLive`/`streamShowing`/auto-
  retry state machine.
- **Tap mapping unchanged:** the `<video>` is sized to the device LOGICAL aspect exactly like the `<img>`;
  `mapPointToDevice` + `swipe-safety` use `frame.width/height` (fetched once), so gestures are identical.
- **Quality/FPS controls become truthful:** map the sliders to encoder params via a data-channel control
  message → `setParameters` bitrate + `scaleResolutionDownBy` (resolution) + `maxFramerate`. `stream-quality.ts`
  becomes the single source emitting encoder targets for both MJPEG and WebRTC.

## Scaling (one viewer vs many)
- **1:1 (operator ↔ device):** the agent's send-only peer connection is enough; no SFU.
- **Many viewers / fleet:** add an **SFU** (mediasoup / LiveKit) — the agent sends one encoded track to the
  SFU which fans out. Keeps Mac CPU flat. Decide from the 2B-A viewer-count reality.

## Hard targets (acceptance)
- Browser visible: **15–30 fps**. Glass-to-glass: **< 300–500 ms**. Tap visual response: **< 500–800 ms**
  (paired with 2B-B direct-WDA for the command half). No growing backlog (latest-frame-first inherent).
  Quality/FPS truthful (mapped to encoder, measured, never claimed).

## Risks / cost to budget
- A TURN server (hosting + bandwidth), an H.264 encoder + WebRTC lib on the Mac (CPU per session), a
  signaling table/migration, and a real client `RTCPeerConnection` integration. This is a multi-day build,
  not a tweak — **measurement (2B-A) must justify it first**, and a **Mac spike** (MJPEG→H.264→one browser
  peer on LAN, no TURN) should precede the full path, exactly like the MJPEG PoC.

## Rollout / rollback
- Env-gated `PFA_WEBRTC=1` (agent) + a frontend flag selecting WebRTC-preferred. Rollback = flag off →
  MJPEG; stop the TURN/SFU; drop the signaling rows. MJPEG + Snapshot remain fully intact throughout.
