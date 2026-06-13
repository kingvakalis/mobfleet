import { test, type Page } from 'playwright/test'

/** Captures RBAC screenshots for the delivery report. Run explicitly:
 *  npx playwright test --project=capture */

const SESSION_KEY = 'mobfleet-session-v1'
const DIR = 'screenshots'

async function actAs(page: Page, empId: string) {
  await page.addInitScript(
    ([key, id]) => localStorage.setItem(key, JSON.stringify({ state: { actingId: id }, version: 0 })),
    [SESSION_KEY, empId] as const,
  )
}
const open = (page: Page, label: string) =>
  page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: label, exact: true }).click()

test('owner — full sidebar + account database (masked)', async ({ page }) => {
  await actAs(page, 'emp-01')
  await page.goto('/')
  await open(page, 'Account Database')
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${DIR}/01-owner-accounts-masked.png` })
})

test('owner — permission matrix (Team › Roles & Permissions)', async ({ page }) => {
  await actAs(page, 'emp-01')
  await page.goto('/')
  await open(page, 'Team')
  await page.getByRole('button', { name: 'Roles & Permissions' }).click()
  // Wait for content unique to the matrix toolbar before capturing.
  await page.getByPlaceholder('Search permissions…').waitFor({ state: 'visible' })
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${DIR}/02-owner-permission-matrix.png` })
})

test('owner — security audit log (Activity)', async ({ page }) => {
  await actAs(page, 'emp-01')
  await page.goto('/')
  // Generate audit events first by revealing a credential.
  await open(page, 'Account Database')
  await page.getByRole('button', { name: 'Reveal value' }).first().click()
  await open(page, 'Activity')
  await page.getByRole('button', { name: /Security Audit/i }).click()
  // Wait for content unique to the audit tab before capturing.
  await page.getByPlaceholder('Search audit log...').waitFor({ state: 'visible' })
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${DIR}/03-owner-security-audit.png` })
})

test('operator — scoped phone registry', async ({ page }) => {
  await actAs(page, 'emp-03')
  await page.goto('/')
  await open(page, 'Phones')
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${DIR}/04-operator-scoped-phones.png` })
})

test('viewer — restricted sidebar + read-only phone control', async ({ page }) => {
  await actAs(page, 'emp-05')
  await page.goto('/')
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${DIR}/05-viewer-sidebar.png` })
})
