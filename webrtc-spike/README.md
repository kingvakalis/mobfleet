# Stage 2C — WebRTC spike

**Goal:** prove whether WebRTC can replace MJPEG as MobFleet's preferred live phone-control stream.
This is a **measured prototype, not production**. It touches **no production code** — MJPEG + Snapshot
fallback are untouched and stay the default. Nothing here is wired into the agent, frontend, or relay.

```
 iPhone ──USB──► Mac
                  │ WDA MJPEG  http://127.0.0.1:9100   (already enabled for Stage 2A)
                  ▼
            ffmpeg  (H.264, -tune zerolatency)
                  │ RTP/UDP 127.0.0.1:5004
                  ▼
        sender.ts  werift RTCPeerConnection (send-only H.264)
                  │            ▲
        SDP over Supabase Realtime  channel  webrtc:<deviceId>   (SDP only — never media)
                  │            ▼
                  ▼
        viewer.html  browser RTCPeerConnection (recvonly) ──► <video> + getStats panel
```

Media is **peer-to-peer** (DTLS-SRTP, STUN). Supabase carries only the SDP handshake. No video ever
touches Postgres. The raw WDA `:9100` port is never exposed — only ffmpeg (localhost) reads it.

## Why this shape

- **werift** = pure-Node WebRTC, so the sender runs in the same Node runtime as the device-agent — no
  browser/headless-Chrome on the Mac.
- **ffmpeg** does MJPEG→H.264 because that is the encode the browser decodes in hardware; H.264 over RTP
  with `nack`/`pli` is the standard low-latency, loss-resilient video path (this is the bit MJPEG lacks —
  it has no loss recovery, so a dropped frame stalls the whole stream).
- **Non-trickle ICE** (candidates baked into the SDP) keeps signaling to exactly two messages
  (offer → answer). Fine for a same-LAN spike.

## Prerequisites (on the Mac)

```bash
brew install ffmpeg          # ffmpeg -version  (need libx264)
cd webrtc-spike
npm install                  # werift + supabase-js + tsx
```

WDA MJPEG must be live for the target device — it already is from Stage 2A (Appium cap
`mjpegServerPort`). Confirm with:

```bash
curl -s -m1 http://127.0.0.1:9100 -o /dev/null -w '%{http_code}\n'   # 200 = MJPEG up
```

If a different device uses a different MJPEG port, pass `MJPEG_PORT=<port>`.

## Run

**1. Unit test the ffmpeg arg builder (works anywhere, no device needed):**

```bash
npm test
```

**2. Start the sender on the Mac** (next to the device-agent):

```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_ANON_KEY=<anon key> \
DEVICE_ID=<device uuid> \
FPS=15 \
npm run sender
# optional: MJPEG_PORT=9100  RTP_PORT=5004  SCALE=540
```

Wait for `{"event":"webrtc.spike.ready",...}`.

**3. Open the viewer** in a browser (same LAN as the Mac for the first measurement):

- Open `webrtc-spike/viewer.html` (double-click, or serve it: `npx serve webrtc-spike`).
- Paste the same `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DEVICE_ID`.
- Click **Connect & measure**.

The sender logs `webrtc.offer.received` → `webrtc.answer.sent` → `webrtc.state {connected}`, ffmpeg
starts, and the `<video>` should show the live phone within ~1–2 s. The stats panel updates every second.

## What to measure (record these — they decide go/no-go vs MJPEG)

| Metric | Where | Target |
|---|---|---|
| **Visible fps** | viewer stats `visible fps` | 15–30 |
| **Glass-to-glass latency** | point the phone at a millisecond stopwatch (or the Mac screen clock), screenshot phone+video together, subtract | **< 300–500 ms** |
| **Mac CPU** | `top -pid $(pgrep -n ffmpeg)` (and the node sender) | sustainable on the Mac mini |
| **Bandwidth** | viewer stats `bitrate` | reasonable on the LAN |
| **Backlog under motion** | scroll/flick the phone; watch `visible fps`, `packetsLost`, `pliCount` | no growing lag; latest-frame-first (WebRTC drops, doesn't queue) |
| **Controls still work** | tap/swipe/Home via the normal app while streaming | unaffected (this spike is video-only; commands still go through the agent) |
| **Reconnect** | kill the viewer tab, reopen, Connect again; then `SIGINT` the sender and restart | re-offer reconnects cleanly; sender tears down ffmpeg+pc on disconnect |

Record numbers for: **idle**, **steady scroll**, **fast flick**, and a **Home-screen swipe**.

## Known spike limitations (intentional — do not "fix" in the spike)

- **One viewer at a time.** A second offer tears down the first peer. Production would key peers per
  viewer + add a TURN server.
- **No auth on the signaling channel.** Production must gate the channel with a stream-token (reuse the
  Stage 2A `mint_stream_token` / team-membership check) so only team members can offer/answer.
- **STUN only.** Same-LAN works; a remote viewer behind symmetric NAT needs a TURN server — add it to
  `iceServers` in both `sender.ts` and `viewer.html`.
- **werift codec/RTP wiring is version-sensitive.** If the browser connects but shows no frames, the
  usual culprits are: H.264 `profile-level-id` / `packetization-mode` mismatch, the ffmpeg RTP payload
  type not matching the negotiated PT, or ffmpeg not actually emitting to `RTP_PORT`. Iterate on
  `src/ffmpeg.ts` (encode) and the `RTCRtpCodecParameters` in `src/sender.ts` (negotiation).

## Decision

If WebRTC hits **15–30 fps under 300–500 ms with no motion backlog** and the Mac CPU is sustainable, it
beats MJPEG and we promote it to the preferred path (then build: per-viewer peers, token-gated signaling,
TURN, and wiring into the agent + frontend behind a flag). If it can't — or the Mac CPU cost is too high —
we keep MJPEG and document why. **Direct-WDA (command latency) is a separate track and unaffected either
way.**
