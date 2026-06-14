// Verify the phone redesign: phone-shaped nodes + interactive device console.
import { chromium } from 'playwright'

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
})
const page = await ctx.newPage()
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(1400)

// Zoom in to see the phones clearly.
await page.mouse.move(720, 470)
await page.mouse.wheel(0, -500)
await page.waitForTimeout(150)
await page.mouse.wheel(0, -300)
await page.waitForTimeout(400)
await page.screenshot({ path: '.shots/phones-graph.png' })

// Open the console for a busy device (shows the upload app).
const busyId = await page.evaluate(async () => {
  const d = await window.__fleet.listDevices()
  return (d.find((x) => x.status === 'busy') ?? d[0]).id
})
await page.locator(`.react-flow__node[data-id="${busyId}"]`).dblclick()
await page.waitForTimeout(1500)
await page.screenshot({ path: '.shots/phones-drawer.png' })

await browser.close()
console.log('phone shots saved')
