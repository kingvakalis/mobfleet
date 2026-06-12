import { chromium } from 'playwright'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark' })
const page = await ctx.newPage()
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(1600)

async function nav(label, file) {
  try {
    await page.getByText(new RegExp(`^${label}$`, 'i')).first().click({ timeout: 4000 })
    await page.waitForTimeout(900)
    await page.screenshot({ path: file })
    console.log('shot', file)
  } catch (e) {
    console.log('nav fail', label, e.message)
  }
}

await nav('groups', '.shots/v2-groups.png')
await nav('proxies', '.shots/v2-proxies.png')
await nav('automations', '.shots/v2-automations.png')

await browser.close()
