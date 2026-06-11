// Verify the new feature views: automations, proxies, groups + group filter.
import { chromium } from 'playwright'

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
})
const page = await ctx.newPage()
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(1300)

await page.getByRole('button', { name: 'AUTOMATIONS' }).click()
await page.waitForTimeout(600)
await page.screenshot({ path: '.shots/feat-automations.png' })

await page.getByRole('button', { name: 'PROXIES' }).click()
await page.waitForTimeout(600)
await page.screenshot({ path: '.shots/feat-proxies.png' })

await page.getByRole('button', { name: 'GROUPS' }).click()
await page.waitForTimeout(600)
await page.screenshot({ path: '.shots/feat-groups.png' })

// Focus a group → jumps to filtered fleet
await page.getByRole('button', { name: 'View' }).first().click()
await page.waitForTimeout(900)
await page.screenshot({ path: '.shots/feat-group-filter.png' })

await browser.close()
console.log('feature shots saved')
