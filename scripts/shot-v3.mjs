import { chromium } from 'playwright'
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1700, height: 950 } })
await page.goto('http://localhost:5176', { waitUntil: 'networkidle' })
await page.waitForSelector('.react-flow__node', { timeout: 40000 })
await page.waitForTimeout(1500)

// fleet with a group filter applied (legend + chips + dimming)
await page.getByRole('button', { name: 'Group', exact: true }).click()
await page.waitForTimeout(300)
await page.locator('button', { hasText: 'Carolina' }).first().click()
await page.locator('button', { hasText: 'Lucia' }).first().click()
await page.keyboard.press('Escape')
await page.mouse.click(900, 200)
await page.waitForTimeout(800)
await page.screenshot({ path: 'v3-fleet-filtered.png', timeout: 60000 })

// settings appearance
await page.getByRole('button', { name: 'SETTINGS' }).click()
await page.waitForTimeout(1500)
await page.screenshot({ path: 'v3-settings.png', timeout: 60000 })

// midnight theme preview applied to draft
await page.getByRole('radio', { name: /Midnight/ }).click()
await page.getByRole('radio', { name: /Blue/ }).click()
await page.getByRole('button', { name: /^Save$/i }).click()
await page.waitForTimeout(800)
await page.getByRole('button', { name: 'PHONES' }).click()
await page.waitForTimeout(1500)
await page.screenshot({ path: 'v3-midnight-phones.png', timeout: 60000 })

console.log('done')
await browser.close()
