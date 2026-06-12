import { chromium } from 'playwright'
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1700, height: 950 } })
page.on('pageerror', e => console.log('[pageerror]', e.message))
const shot = (name) => page.screenshot({ path: `audit-${name}.png`, animations: 'disabled', timeout: 60000 })
const nav = async (label) => { await page.getByRole('button', { name: label, exact: false }).first().click(); await page.waitForTimeout(1400) }

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
await shot('fleet2d')

await nav('TEAM')
await shot('team')

await nav('SETTINGS')
await shot('settings')

await nav('AUTOMATIONS')
await shot('automations')

await nav('JOBS')
await shot('jobs')

await nav('ACTIVITY')
await shot('activity')

await nav('GROUPS')
await shot('groups')

await nav('PHONES')
await shot('phones')

// open drawer (proxy-free, control suite)
await page.locator('tbody tr').first().dblclick()
await page.waitForTimeout(2000)
await shot('drawer')
await page.keyboard.press('Escape')
await page.waitForTimeout(500)

// control page
await page.locator('tbody tr td button', { hasText: 'CONTROL' }).first().click()
await page.waitForTimeout(2200)
await shot('control')

console.log('done')
await browser.close()
