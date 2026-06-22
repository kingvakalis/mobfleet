/**
 * Trigger a browser download of an ALREADY-FETCHED screenshot frame — no Supabase
 * Storage, no Postgres beyond the existing `device_screenshots` frame. The base64 the
 * caller already loaded (via getLatestScreenshot) is wrapped in a data: URL and saved
 * to the user's PC as `mobfleet-{deviceName}-{timestamp}.{ext}`.
 *
 * Only call this on a REAL, successfully-captured frame (e.g. after a screenshot command
 * acks). Never fabricate success — if there's no frame, don't download.
 */
export function downloadScreenshot(deviceName: string, imageBase64: string, format: string): void {
  if (typeof document === 'undefined' || !imageBase64) return
  const ext = format === 'jpeg' ? 'jpg' : format === 'webp' ? 'webp' : 'png'
  const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png'
  const safeName =
    (deviceName || 'device').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'device'
  // Sortable, filesystem-safe local timestamp: YYYY-MM-DD-HH-MM-SS.
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
  const a = document.createElement('a')
  a.href = `data:${mime};base64,${imageBase64}`
  a.download = `mobfleet-${safeName}-${stamp}.${ext}`
  document.body.appendChild(a)
  a.click()
  a.remove()
}
