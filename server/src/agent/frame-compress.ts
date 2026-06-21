/**
 * Frame compression for the live-screen transport. A native WDA `/screenshot` is a full-res
 * PNG (~1.9–2.2 MB) which saturates the Supabase HTTP pool and blows the RPC timeout. We
 * downscale + re-encode to a small JPEG/WebP (default ~540px wide, q55 → ~30–40 KB) before
 * upload, keeping the device LOGICAL width/height (points) UNCHANGED so the dashboard's
 * coordinate mapping is unaffected (it maps against logical points, not pixels).
 *
 * `sharp` is an OPTIONAL native dependency, loaded dynamically: if it is absent (or
 * compression throws on a bad buffer) we fall back to the original frame — never drop a
 * frame. Configurable via env (FRAME_WIDTH / FRAME_QUALITY / FRAME_FORMAT).
 */
import type { ScreenshotFrame } from './agent-runtime'

export interface FrameCompressionConfig { width: number; quality: number; format: 'jpeg' | 'webp' }

/** Parse FRAME_WIDTH / FRAME_QUALITY / FRAME_FORMAT into a clamped config. PURE + tested. */
export function compressionConfigFromEnv(env: Record<string, string | undefined>): FrameCompressionConfig {
  const num = (v: string | undefined, d: number, min: number, max: number) => {
    const n = v != null && v !== '' ? Number(v) : NaN
    return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : d
  }
  return {
    width: num(env.FRAME_WIDTH, 540, 120, 2000),
    quality: num(env.FRAME_QUALITY, 55, 10, 95),
    format: (env.FRAME_FORMAT || '').toLowerCase() === 'webp' ? 'webp' : 'jpeg',
  }
}

// Cached module handle: undefined = not yet tried, null = unavailable (don't retry).
let sharpMod: unknown = undefined
async function loadSharp(): Promise<((input: Buffer) => SharpPipe) | null> {
  if (sharpMod !== undefined) return sharpMod as ((input: Buffer) => SharpPipe) | null
  try {
    const name = 'sharp' // non-literal specifier → not type-resolved (optional dep)
    const m = (await import(name)) as { default?: unknown }
    sharpMod = (m.default ?? m) as unknown
  } catch {
    sharpMod = null
  }
  return sharpMod as ((input: Buffer) => SharpPipe) | null
}

interface SharpPipe {
  rotate(): SharpPipe
  resize(o: { width: number; withoutEnlargement: boolean }): SharpPipe
  jpeg(o: { quality: number }): SharpPipe
  webp(o: { quality: number }): SharpPipe
  toBuffer(): Promise<Buffer>
}

/**
 * Downscale + re-encode a raw screenshot frame for fast transport. Keeps the device LOGICAL
 * width/height. Returns the INPUT frame unchanged when sharp is unavailable or compression
 * fails (never drops a frame). The base64 is the COMPRESSED image; format reflects the encode.
 */
export async function compressFrame(frame: ScreenshotFrame, cfg: FrameCompressionConfig): Promise<ScreenshotFrame> {
  const sharp = await loadSharp()
  if (!sharp) return frame
  try {
    const input = Buffer.from(frame.base64, 'base64')
    if (input.length === 0) return frame
    let pipe = sharp(input).rotate().resize({ width: cfg.width, withoutEnlargement: true })
    pipe = cfg.format === 'webp' ? pipe.webp({ quality: cfg.quality }) : pipe.jpeg({ quality: cfg.quality })
    const out = await pipe.toBuffer()
    if (!out || out.length === 0) return frame
    return { base64: out.toString('base64'), format: cfg.format, width: frame.width, height: frame.height }
  } catch {
    return frame
  }
}
