/**
 * Stage 2C WebRTC SPIKE — AGENT SENDER (run on the Mac next to the device-agent).
 *
 *   WDA MJPEG http://127.0.0.1:<MJPEG_PORT>  →  ffmpeg (H.264, zerolatency)  →  UDP RTP
 *      →  werift RTCPeerConnection (send-only H.264)  →  one browser <video>
 *
 * Signaling (SDP) is exchanged over a Supabase Realtime broadcast channel `webrtc:<deviceId>` — Supabase
 * carries ONLY SDP, never media. Non-trickle ICE (candidates baked into the SDP) keeps the spike simple.
 * Media is peer-to-peer (STUN); a TURN server is only needed for remote/symmetric-NAT viewers (see README).
 *
 * THIS IS A SPIKE. It is NOT wired into the production agent and touches no production code. The werift
 * codec/RTP wiring + ffmpeg flags are version-sensitive — expect to iterate on the real Mac. Measure with
 * the browser viewer's getStats panel + `top` for ffmpeg CPU (see README).
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, DEVICE_ID, [MJPEG_PORT=9100], [RTP_PORT=5004], [FPS=15], [SCALE].
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createSocket } from 'node:dgram'
import { createClient } from '@supabase/supabase-js'
import { RTCPeerConnection, RTCRtpCodecParameters, MediaStreamTrack } from 'werift'
import { buildFfmpegArgs } from './ffmpeg.js'

const env = (k: string, d?: string) => process.env[k] ?? d ?? ''
const SUPABASE_URL = env('SUPABASE_URL')
const SUPABASE_ANON_KEY = env('SUPABASE_ANON_KEY')
const DEVICE_ID = env('DEVICE_ID')
const MJPEG_PORT = Number(env('MJPEG_PORT', '9100'))
const RTP_PORT = Number(env('RTP_PORT', '5004'))
const FPS = Number(env('FPS', '15'))
const SCALE = process.env.SCALE ? Number(process.env.SCALE) : null

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !DEVICE_ID) {
  console.error('set SUPABASE_URL, SUPABASE_ANON_KEY, DEVICE_ID'); process.exit(2)
}
const log = (event: string, fields?: Record<string, unknown>) => console.log(JSON.stringify({ ts: Date.now(), event, ...fields }))

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { realtime: { params: { eventsPerSecond: 20 } } })
const channel = supabase.channel(`webrtc:${DEVICE_ID}`, { config: { broadcast: { ack: false } } })

let pc: RTCPeerConnection | null = null
let ffmpeg: ChildProcess | null = null
const rtp = createSocket('udp4')

function teardown(): void {
  try { ffmpeg?.kill('SIGKILL') } catch { /* noop */ }
  try { void pc?.close() } catch { /* noop */ }
  ffmpeg = null; pc = null
}

// Non-trickle ICE: resolve once gathering is done so the SDP we send carries every candidate.
function waitIceComplete(p: RTCPeerConnection): Promise<void> {
  if (p.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise<void>((resolve) => {
    p.iceGatheringStateChange.subscribe((state) => { if (state === 'complete') resolve() })
  })
}

async function onOffer(offerSdp: string): Promise<void> {
  teardown() // one peer at a time for the spike
  log('webrtc.offer.received')

  const track = new MediaStreamTrack({ kind: 'video' })
  pc = new RTCPeerConnection({
    codecs: {
      video: [
        new RTCRtpCodecParameters({
          mimeType: 'video/H264',
          clockRate: 90000,
          payloadType: 96, // pin the negotiated PT to match ffmpeg's `-payload_type 96`
          rtcpFeedback: [{ type: 'nack' }, { type: 'nack', parameter: 'pli' }, { type: 'goog-remb' }],
          parameters: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f',
        }),
      ],
    },
    // STUN only for the spike (same-LAN / good NAT). Add a TURN server here for remote viewers.
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  })
  pc.addTransceiver(track, { direction: 'sendonly' })
  pc.connectionStateChange.subscribe((s) => { log('webrtc.state', { state: s }); if (s === 'failed' || s === 'closed') teardown() })

  await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp })
  const answer = await pc.createAnswer()
  await pc.setLocalDescription(answer)
  await waitIceComplete(pc) // non-trickle: bake candidates into the SDP
  await channel.send({ type: 'broadcast', event: 'answer', payload: { sdp: pc.localDescription!.sdp } })
  log('webrtc.answer.sent')

  // ffmpeg: WDA MJPEG → H.264 RTP → our UDP port → werift track
  ffmpeg = spawn('ffmpeg', buildFfmpegArgs({ mjpegPort: MJPEG_PORT, rtpPort: RTP_PORT, fps: FPS, scale: SCALE }), { stdio: ['ignore', 'ignore', 'inherit'] })
  ffmpeg.on('exit', (code) => log('ffmpeg.exit', { code }))
  rtp.removeAllListeners('message')
  rtp.on('message', (msg) => { try { track.writeRtp(msg) } catch (e) { log('rtp.write.error', { error: (e as Error)?.message }) } })
}

async function main(): Promise<void> {
  await new Promise<void>((resolve) => rtp.bind(RTP_PORT, '127.0.0.1', resolve))
  channel
    .on('broadcast', { event: 'offer' }, ({ payload }) => { void onOffer((payload as { sdp: string }).sdp) })
    .subscribe((status) => log('signaling.channel', { status }))
  log('webrtc.spike.ready', { deviceId: DEVICE_ID, mjpegPort: MJPEG_PORT, rtpPort: RTP_PORT, fps: FPS })
  process.on('SIGINT', () => { teardown(); process.exit(0) })
}
main().catch((e) => { console.error('spike sender error:', (e as Error)?.message); process.exit(1) })
