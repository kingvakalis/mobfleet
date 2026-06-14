// Verify Slice-9 states: boot/loading + empty fleet.
import { chromium } from 'playwright'

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
})

// Boot / loading — capture inside the uplink handshake window.
const p1 = await ctx.newPage()
await p1.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
await p1.waitForTimeout(560)
await p1.screenshot({ path: '.shots/boot.png' })
await p1.close()

// Empty fleet — retire everything, watch it drain to the empty CTA.
const page = await ctx.newPage()
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(1300)
const ids = await page.evaluate(async () => {
  const devs = await window.__fleet.listDevices()
  return devs.map((d) => d.id)
})
await page.evaluate((ids) => ids.forEach((id) => window.__fleet.delete(id)), ids)
await page.waitForTimeout(1000)
await page.screenshot({ path: '.shots/empty.png' })

await browser.close()
console.log('state shots saved')
