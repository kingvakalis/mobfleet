// Verify Slice-3 motion: edge pulses, warp-in, dissolve.
import { chromium } from 'playwright'

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
})
const page = await ctx.newPage()
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await page.screenshot({ path: '.shots/m-edges.png' })

// Warp-in: provision a burst, capture just as they mount.
await page.evaluate(() => window.__fleet.createDevices(8, { region: 'us-east-1' }))
await page.waitForTimeout(70)
await page.screenshot({ path: '.shots/m-warp.png' })

await page.waitForTimeout(1400)

// Dissolve: retire several, capture mid-fade.
const ids = await page.evaluate(async () => {
  const devs = await window.__fleet.listDevices()
  return devs.slice(0, 6).map((d) => d.id)
})
await page.evaluate((ids) => ids.forEach((id) => window.__fleet.delete(id)), ids)
await page.waitForTimeout(130)
await page.screenshot({ path: '.shots/m-dissolve.png' })

await browser.close()
console.log('motion shots saved')
