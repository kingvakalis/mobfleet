/**
 * Live MJPEG stream resolution for Phone Control (Stage 2A).
 *
 * The real device screen is streamed as MJPEG (multipart/x-mixed-replace) instead of the screenshot
 * rows. Video NEVER goes through Postgres: the Mac agent reads WDA's local 127.0.0.1:9100 MJPEG and
 * pushes it OUTBOUND over WSS to an authenticated hosted relay; the relay serves multipart/x-mixed-
 * replace to authorized team members behind a short-lived, device-scoped stream token. The browser
 * renders the relay URL in the existing phone <img> (no canvas, no WebRTC).
 *
 * This module mints the access token (Supabase RPC `mint_stream_token`, RLS: team member) and builds
 * the relay URL. No service-role secret is used — the token is minted under the operator's own JWT.
 * If the relay base (VITE_STREAM_RELAY_URL) is unset or the mint fails, it returns null → GO LIVE uses
 * the screenshot-row fallback UNCHANGED. A localStorage override points at a tunnelled stream for spikes.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export interface DeviceStream {
  /** The URL the browser renders in <img src> (the relay's multipart/x-mixed-replace endpoint). */
  url: string
  /** True only if the relay accepts live framerate/quality changes so the Quality/FPS sliders can
   *  drive mjpegServerFramerate / mjpegServerScreenshotQuality / mjpegScalingFactor. False → the
   *  sliders apply to the snapshot fallback only (shown truthfully in the UI). The agent supports
   *  live MJPEG settings (confirmed on Mac); wiring them through the relay is a follow-up, so this
   *  is false until that control channel exists. */
  canControlSettings: boolean
}

// Hosted relay base, e.g. https://stream.mobfleet.co — injected at build time. Unset → no streaming.
const RELAY_BASE = ((import.meta.env.VITE_STREAM_RELAY_URL as string | undefined) ?? '').replace(/\/+$/, '')

function readOverride(deviceId: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage.getItem(`pfa:streamUrl:${deviceId}`) || localStorage.getItem('pfa:streamUrl')
  } catch { return null }
}

/** Opt-in stream debug: localStorage 'pfa:debugStream' = '1'. OFF by default. */
export function streamDebug(...a: unknown[]): void {
  try { if (typeof localStorage !== 'undefined' && localStorage.getItem('pfa:debugStream') === '1') console.debug('[pfa:stream]', ...a) } catch { /* ignore */ }
}
const maskTok = (u: string) => u.replace(/([?&]t=)[^&]+/, '$1…')

/**
 * Resolve a live MJPEG stream for a device, or null when none is available (→ screenshot fallback).
 * Never throws — a failure to acquire a stream must degrade to the fallback, not break GO LIVE.
 */
export async function resolveDeviceStream(o: { deviceId: string; teamId: string }): Promise<DeviceStream | null> {
  // Spike / local-test override: an explicit (possibly tunnelled) MJPEG URL. Settings are not live-
  // controllable over a raw stream, so the sliders stay snapshot-only here.
  const override = readOverride(o.deviceId)
  if (override) { streamDebug('using override URL', maskTok(override)); return { url: override, canControlSettings: false } }

  if (!RELAY_BASE || !supabase) { streamDebug('fallback: relay base unset or supabase missing', { relayBase: !!RELAY_BASE }); return null }
  try {
    // Mint a short-lived, device-scoped token under the operator's JWT (RLS: team member). A token for
    // one device cannot view another (the relay's redeem checks device_id). Video never touches PG.
    const client = supabase as unknown as SupabaseClient
    const { data, error } = await client.rpc('mint_stream_token', { p_device_id: o.deviceId })
    if (error) { streamDebug('fallback: mint_stream_token error', error.message); return null }
    const row = (Array.isArray(data) ? data[0] : data) as { token?: string } | null
    const token = row?.token
    if (!token) { streamDebug('fallback: mint returned no token'); return null }
    const url = `${RELAY_BASE}/stream/${encodeURIComponent(o.deviceId)}?t=${encodeURIComponent(token)}`
    streamDebug('resolved streamUrl', maskTok(url))
    return { url, canControlSettings: false }
  } catch (e) { streamDebug('fallback: mint threw', String(e)); return null }
}
