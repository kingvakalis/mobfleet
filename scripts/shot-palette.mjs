// Verify Slice-8: command palette.
import { chromium } from 'playwright'

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
})
const page = await ctx.newPage()
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)

await page.keyboard.press('Control+k')
await page.waitForTimeout(450)
await page.screenshot({ path: '.shots/palette.png' })

await page.keyboard.type('prov')
await page.waitForTimeout(350)
await page.screenshot({ path: '.shots/palette-filter.png' })

await browser.close()
console.log('palette shots saved')
