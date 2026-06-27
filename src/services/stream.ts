/**
 * Live MJPEG stream resolution for Phone Control (Stage 2A).
 *
 * The real device screen can be streamed as MJPEG (multipart/x-mixed-replace) instead of the
 * screenshot-row path. Video NEVER goes through Postgres: the Mac agent reads WDA's local
 * 127.0.0.1:9100 MJPEG and pushes it OUTBOUND to an authenticated HTTPS/WSS relay; the relay serves
 * it to authorized team members behind a short-lived, device-scoped stream token. The browser renders
 * the relay URL in the existing phone <img> (no canvas, no WebRTC).
 *
 * This module is the SEAM the UI consumes. Until the relay + the `mint_stream_token` RPC exist it
 * returns null → GO LIVE uses the screenshot-row fallback UNCHANGED (so production is a no-op today).
 * A localStorage override lets the Mac owner / a dev point at a tunnelled stream during the spike:
 *   localStorage['pfa:streamUrl:<deviceId>'] = 'https://relay.example/stream/...'   (per device)
 *   localStorage['pfa:streamUrl']            = 'http://127.0.0.1:9100'              (any device, dev only)
 * (a raw http:// URL only loads on a localhost dev origin — mobfleet.co is HTTPS, so production needs
 * the HTTPS relay.) No service-role secret is ever used here; this only resolves/mints a URL.
 */

export interface DeviceStream {
  /** The URL the browser renders in <img src> (an HTTPS multipart/x-mixed-replace endpoint in prod). */
  url: string
  /** True only if the relay accepts live framerate/quality changes, so the Quality/FPS sliders can
   *  drive mjpegServerFramerate / mjpegServerScreenshotQuality / mjpegScalingFactor. False → the
   *  sliders apply to the snapshot fallback only (shown truthfully in the UI). */
  canControlSettings: boolean
}

function readOverride(deviceId: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage.getItem(`pfa:streamUrl:${deviceId}`) || localStorage.getItem('pfa:streamUrl')
  } catch { return null }
}

/**
 * Resolve a live MJPEG stream for a device, or null when none is available (→ screenshot fallback).
 * Never throws — a failure to acquire a stream must degrade to the fallback, not break GO LIVE.
 */
export async function resolveDeviceStream(o: { deviceId: string; teamId: string }): Promise<DeviceStream | null> {
  // Spike / local-test override: an explicit (possibly tunnelled) MJPEG URL. Settings are NOT live-
  // controllable over a raw stream, so the sliders stay snapshot-only here.
  const override = readOverride(o.deviceId)
  if (override) return { url: override, canControlSettings: false }

  // Production relay path — NOT built yet. When the relay + token RPC land, this will:
  //   1. supabase.rpc('mint_stream_token', { p_device_id }) → { token, expires_at } (RLS: team member),
  //   2. return { url: `${RELAY_BASE}/stream/${deviceId}?t=${token}`, canControlSettings: <relay caps> }.
  // Returning null today keeps GO LIVE on the screenshot-row fallback (production no-op).
  return null
}
