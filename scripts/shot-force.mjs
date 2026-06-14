import { chromium } from 'playwright'
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1700, height: 950 } })
await page.goto('http://localhost:5179', { waitUntil: 'networkidle' })
await page.waitForSelector('.react-flow__node', { timeout: 40000 })
await page.waitForTimeout(2500)

// select a phone → card + dim + edge highlight
await page.locator('.react-flow__node[data-id]:not([data-id="orchestrator"])').nth(4).click()
await page.waitForTimeout(900)
await page.screenshot({ path: 'f-selected.png', timeout: 60000 })
await page.keyboard.press('Escape')

// activity drawer crispness
await page.getByRole('button', { name: 'Activity', exact: false }).first().click()
await page.waitForTimeout(900)
await page.screenshot({ path: 'f-activity.png', timeout: 60000 })

// accounts add modal with password field
await page.getByRole('button', { name: 'ACCOUNT DATABASE' }).click()
await page.waitForTimeout(1500)
await page.getByRole('button', { name: /Add Account/i }).first().click()
await page.waitForTimeout(600)
await page.screenshot({ path: 'f-add-account.png', timeout: 60000 })
console.log('done')
await browser.close()
