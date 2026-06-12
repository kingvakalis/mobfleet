// Dev-only: screenshot the 3D fleet view for visual verification.
import { chromium } from 'playwright'

const url = process.env.APP_URL ?? 'http://localhost:5173'
const out = process.argv[2] ?? 'shot-3d.png'

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text()) })
page.on('pageerror', e => console.log('[pageerror]', e.message))

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

// Switch to 3D mode
await page.getByRole('button', { name: /3D/i }).first().click()
await page.waitForTimeout(6000) // let intro flight + warp-in settle

await page.screenshot({ path: out })
console.log('saved', out)
await browser.close()
