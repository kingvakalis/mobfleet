// Verify Slice-5: device drawer + live log stream.
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

// Open the drawer via double-click, then let the log stream build.
await page.locator('.react-flow__node-device').first().dblclick()
await page.waitForTimeout(2600)
await page.screenshot({ path: '.shots/drawer.png' })

await browser.close()
console.log('drawer shot saved')
