# Stage 2B-A — Measurement Gate (runbook)

> The gate before committing to WebRTC. Capture the numbers below on the **Mac + a real browser** (I can't
> measure from CI/Windows). Everything is already instrumented — this is how to read it. Hard targets at
> the bottom; if MJPEG can't hit them, 2B-C WebRTC is justified.

## What to set
```bash
# Mac agent (publisher + command timing + direct-WDA timing)
PFA_MJPEG=1  PFA_MJPEG_RELAY_URL=wss://mobfleet-stream-relay.fly.dev/publish
PFA_MJPEG_DEBUG=1      # → "mjpeg.metrics" every 5s
PFA_DEBUG_LATENCY=1    # → "agent.command.timing" per command + "wda.direct" when 2B-B is on
# Browser: in devtools console
localStorage.setItem('pfa:debugLatency','1')   // cmd → acked round-trip
localStorage.setItem('pfa:debugStream','1')    // stream lifecycle
```

## 1. Mac publisher — FPS / bandwidth / bufferedAmount
Read the agent's `mjpeg.metrics` line (every 5s):
```json
{"event":"mjpeg.metrics","udid":"…","read":…,"forwarded":…,"deduped":…,"reconnects":…,
 "errors":…,"forwardedBytes":…,"fwdFps":…,"kbps":…,"bufferedAmount":…}
```
- **fwdFps** = frames/s actually pushed to the relay (should sit near `mjpegServerFramerate`; if lower/bursty, the device or USB is the limit).
- **kbps** = publisher→relay bitrate.
- **bufferedAmount** = bytes queued on the WS but not yet flushed = **publisher→relay backup**. **This is the key ingestion-latency signal** — it should hover near 0. A rising `bufferedAmount` means the link/relay can't keep up (lag).
- `read` vs `forwarded` vs `deduped`: read = frames out of WDA; deduped = identical static frames skipped; forwarded = sent.

## 2. Relay — framesIn / framesOut / framesCoalesced
```bash
watch -n2 'curl -s https://mobfleet-stream-relay.fly.dev/health | jq .streams'
# {"devices":…,"viewers":…,"framesIn":…,"framesOut":…,"framesCoalesced":…}
```
- **framesIn** = frames that reached fan-out (post ingestion-coalescing).
- **framesOut** = frames written to viewers.
- **framesCoalesced** = stale frames dropped (ingestion + viewer). A **high coalesced:framesIn ratio = the relay is correctly dropping to stay fresh** because the source outruns delivery → the browser will never be more than ~1 frame behind, but the *effective* viewer fps is `framesOut / viewers / seconds`.

## 3. Browser — visible FPS
- **Screenshot path:** the Quality-Settings caption already shows `effective ~N/s` (measured from real frame arrivals).
- **MJPEG path:** the most reliable visible-fps proxy is the relay's `framesOut / viewers` over a window (an `<img>` multipart stream doesn't reliably fire per-frame `onload` cross-browser). For a true count, record the screen with the OS recorder and count distinct frames over 5s.

## 4. Browser — glass-to-glass latency
Method (no extra tooling): open a **running stopwatch/clock app on the device** (ms precision), point the
MJPEG view at it, take a single screenshot of the *browser* tab, and read (browser-shown time − device-shown
time). Average 5 captures. (The earlier PoC measured Launch ~455ms / Tap ~781ms / Swipe ~2s reflected.)

## 5. Command latency p50/p95 — Home / tap / swipe / launch
Drive ≥30 of each, then aggregate the agent's `agent.command.timing` lines:
```json
{"event":"agent.command.timing","action":"tap","ageMs":…,"execMs":…,"frameMs":…}
```
```bash
# p50/p95 of execMs per action, from the agent log:
for a in home tap swipe launch; do
  echo -n "$a execMs: "
  grep '"agent.command.timing"' agent.log | grep "\"action\":\"$a\"" \
   | sed -E 's/.*"execMs":([0-9]+).*/\1/' | sort -n \
   | awk '{v[NR]=$1} END{print "p50="v[int(NR*0.5)]" p95="v[int(NR*0.95)]" n="NR}'
done
```
- **ageMs** = issue → agent dispatch (claim cadence + queue) — the transport/command-channel latency.
- **execMs** = the gesture actuation (Appium→WDA→XCTest, or direct-WDA).
- Browser side (devtools): `[pfa:latency] cmd … → acked @+Nms` = full enqueue→ack round-trip.

## 6. Split: video-transport delay vs WDA/Appium execution delay
- **WDA/Appium execution delay** = `agent.command.timing.execMs` (§5) — the gesture itself.
- **Video transport delay** = glass-to-glass (§4) − the on-device render time ≈ publisher capture + `kbps`/relay
  + browser decode. Cross-check against `bufferedAmount` (§1, ≈0 means transport isn't the bottleneck) and the
  relay `framesOut` rate (§2).
- **Direct-WDA vs Appium (2B-B):** run the same taps with `PFA_DIRECT_WDA=0` then `=1`; compare `execMs`
  (and the `wda.direct {ms}` line). The direct path removes the Appium HTTP + XCUITest hop.

## Hard targets (decide 2B-C from these)
| Metric | Target | If missed → |
|---|---|---|
| Browser visible fps | 15–30 | source caps / relay drops → 2B-C WebRTC |
| Glass-to-glass | < 300–500 ms | transport too slow → 2B-C WebRTC |
| Tap visual response | < 500–800 ms (where WDA allows) | 2B-B direct-WDA first; then 2B-C |
| publisher `bufferedAmount` | ~0 (no growth) | link/relay backpressure → tune caps / SFU |
| relay `framesCoalesced` | non-zero under load, latest-first | (working as intended) |

**Decision rule:** if, after 2B-B, tap p95 and glass-to-glass are within target, MJPEG-as-fallback + direct-WDA
controls may be enough. If glass-to-glass stays > ~500 ms or visible fps < 15, proceed to **2B-C WebRTC**
(design: `docs/stage2c-webrtc-design.md`).
