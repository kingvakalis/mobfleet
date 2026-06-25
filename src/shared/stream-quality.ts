/**
 * SHARED, pure mapping for the live-stream QUALITY (0–30 UI level) and FPS (5–30) controls.
 * Alias-free (no `@/`) so the Node agent imports it directly — no DOM / env / side effects, so it
 * is unit-testable in plain Node and identical on both sides of the wire.
 *
 * QUALITY — the UI exposes an abstract 0–30 "level". The real encoder (server/src/agent/frame-compress.ts,
 *   `sharp`) takes a JPEG/WebP quality (10–95) and an output width (px). We map the level onto BOTH so a
 *   higher level is visibly better AND usually a larger upload, and a lower level is smaller/cheaper.
 *   The agent applies this per-command; without a level it keeps its startup (env) config.
 * FPS — maps to a target capture INTERVAL. The Supabase screenshot-command pipeline is not a video
 *   transport and cannot sustain >~1–2 fps, so callers floor the interval to a transport-safe gap and
 *   display the MEASURED effective rate. Higher FPS never "hammers" Supabase (the loop stays sequential).
 */
export const QUALITY_MIN = 0
export const QUALITY_MAX = 30
export const FPS_MIN = 5
export const FPS_MAX = 30
/** Quality level for an explicit Screenshot DOWNLOAD — always full, never the low live-preview level. */
export const SCREENSHOT_DOWNLOAD_QUALITY = QUALITY_MAX

/** The real encoder knobs frame-compress.ts feeds to sharp. */
export interface EncoderConfig { width: number; quality: number }

const clampInt = (n: number, lo: number, hi: number) =>
  Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : lo

export function clampQualityLevel(level: number): number { return clampInt(level, QUALITY_MIN, QUALITY_MAX) }
export function clampFps(fps: number): number { return clampInt(fps, FPS_MIN, FPS_MAX) }

/**
 * Map the 0–30 UI quality level onto the encoder's REAL supported range (sharp):
 *   width   360 → 720 px   (output pixel width; device LOGICAL size is kept unchanged upstream)
 *   quality  30 → 88       (JPEG/WebP quality; sharp-safe, clamped to [10,95])
 * Both rise with the level so the difference is visible and uploads grow with quality.
 */
export function qualityLevelToEncoder(level: number): EncoderConfig {
  const t = clampQualityLevel(level) / QUALITY_MAX // 0..1
  return {
    width: clampInt(360 + t * (720 - 360), 120, 2000),
    quality: clampInt(30 + t * (88 - 30), 10, 95),
  }
}

/**
 * Requested FPS → target capture interval (ms). This is the REQUESTED spacing; the caller still floors
 * it to a transport-safe minimum gap, and the effective rate is whatever the sequential capture loop
 * actually achieves (measured + shown truthfully — never claimed).
 */
export function fpsToIntervalMs(fps: number): number { return Math.round(1000 / clampFps(fps)) }
