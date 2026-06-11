// Verify Slice-6: jobs table + submit dialog.
import { chromium } from 'playwright'

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
})
const page = await ctx.newPage()
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)

await page.getByRole('button', { name: 'JOBS' }).click()
await page.waitForTimeout(700)
await page.screenshot({ path: '.shots/jobs.png' })

await page.getByRole('button', { name: 'Dispatch Job' }).click()
await page.waitForTimeout(500)
await page.screenshot({ path: '.shots/jobs-dialog.png' })

await browser.close()
console.log('jobs shots saved')
