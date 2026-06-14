// Verify Slice-7: scale overlay + provision warp-in behind it.
import { chromium } from 'playwright'

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
})
const page = await ctx.newPage()
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(1300)

await page.getByRole('button', { name: 'Scale' }).click()
await page.waitForTimeout(450)
await page.screenshot({ path: '.shots/scale.png' })

// Provision a batch, capture the warp-in behind the panel.
await page.getByRole('button', { name: 'Provision' }).click()
await page.waitForTimeout(380)
await page.screenshot({ path: '.shots/scale-provision.png' })

await browser.close()
console.log('scale shots saved')
