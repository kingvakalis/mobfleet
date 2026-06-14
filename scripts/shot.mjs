// Dev screenshot util — headless Chromium (no Chrome channel / admin needed).
// Usage: node scripts/shot.mjs <url> <outfile>
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5173/'
const out = process.argv[3] ?? '.shots/shot.png'

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
})
const page = await ctx.newPage()
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(1400) // let fonts + intro motion settle
await page.screenshot({ path: out })
await browser.close()
console.log('saved', out)
