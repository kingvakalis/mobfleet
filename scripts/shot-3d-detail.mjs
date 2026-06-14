import { chromium } from 'playwright'
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)
await page.getByRole('button', { name: /3D/i }).first().click()
await page.waitForTimeout(7000)
// zoom in by scrolling on the canvas center
await page.mouse.move(800, 450)
for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(150) }
await page.waitForTimeout(2500)
await page.screenshot({ path: 'shot-3d-zoom.png', clip: { x: 300, y: 100, width: 1000, height: 700 } })
console.log('saved')
await browser.close()
