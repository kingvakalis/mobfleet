// Verify Slice-4 interactions: hover telemetry card + multi-select + bulk bar.
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

// Hover → telemetry card
const nodes = page.locator('.react-flow__node-device')
await nodes.first().hover()
await page.waitForTimeout(380)
await page.screenshot({ path: '.shots/hover.png' })

// Move away, then multi-select a few nodes
await page.mouse.move(40, 320)
await page.waitForTimeout(250)
await nodes.nth(1).click()
await nodes.nth(3).click({ modifiers: ['ControlOrMeta'] })
await nodes.nth(5).click({ modifiers: ['ControlOrMeta'] })
await nodes.nth(7).click({ modifiers: ['ControlOrMeta'] })
await page.waitForTimeout(450)
await page.screenshot({ path: '.shots/select.png' })

await browser.close()
console.log('interaction shots saved')
