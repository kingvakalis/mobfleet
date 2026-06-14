import { chromium } from 'playwright'
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1700, height: 950 } })
page.on('pageerror', e => console.log('[pageerror]', e.message))
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)

// 1. Phones registry
await page.getByRole('button', { name: 'PHONES' }).click()
await page.waitForTimeout(1500)
await page.screenshot({ path: 'shot-phones.png', animations: 'disabled', timeout: 60000 })

// 2. Device drawer via double-click on first row
await page.locator('tbody tr').first().dblclick()
await page.waitForTimeout(2500)
await page.screenshot({ path: 'shot-drawer.png', animations: 'disabled', timeout: 60000 })

// 3. Launch an app inside the drawer phone, then screenshot
const igBtn = page.locator('button[title="Instagram"]')
if (await igBtn.count()) { await igBtn.click(); await page.waitForTimeout(1200) }
await page.screenshot({ path: 'shot-drawer-app.png', animations: 'disabled', timeout: 60000 })

// 4. Full control page
await page.getByRole('button', { name: /Full Control/i }).click()
await page.waitForTimeout(2000)
await page.screenshot({ path: 'shot-control.png', animations: 'disabled', timeout: 60000 })

// 5. Fleet graph (2D) orchestrator
await page.getByRole('button', { name: 'FLEET' }).click()
await page.waitForTimeout(2500)
await page.screenshot({ path: 'shot-graph.png', animations: 'disabled', timeout: 60000 })

console.log('all saved')
await browser.close()
