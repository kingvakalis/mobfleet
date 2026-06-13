import { test, expect, type Page } from 'playwright/test'

/**
 * Role-scenario E2E. Impersonates seeded employees through the persisted
 * session store and verifies the permission-aware UI:
 *   emp-01 Owner (workspace) · emp-02 Manager (assigned_groups) ·
 *   emp-03 Operator (assigned_phones: BACKUP 1, BACKUP 2) · emp-05 Viewer.
 */

const SESSION_KEY = 'mobfleet-session-v1'

async function actAs(page: Page, empId: string) {
  await page.addInitScript(
    ([key, id]) => localStorage.setItem(key, JSON.stringify({ state: { actingId: id }, version: 0 })),
    [SESSION_KEY, empId] as const,
  )
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Primary' })
const navBtn = (page: Page, label: string) => nav(page).getByRole('button', { name: label, exact: true })
const openSection = (page: Page, label: string) => navBtn(page, label).click()

test.describe('Permission-aware sidebar', () => {
  test('Owner sees every section', async ({ page }) => {
    await actAs(page, 'emp-01')
    await page.goto('/')
    for (const label of ['Fleet', 'Phones', 'Account Database', 'Groups', 'Team', 'Automations', 'Jobs', 'Activity', 'Settings']) {
      await expect(navBtn(page, label)).toBeVisible()
    }
  })

  test('Viewer sees only read-only sections', async ({ page }) => {
    await actAs(page, 'emp-05')
    await page.goto('/')
    await expect(navBtn(page, 'Fleet')).toBeVisible()
    await expect(navBtn(page, 'Phones')).toBeVisible()
    await expect(navBtn(page, 'Groups')).toBeVisible()
    await expect(navBtn(page, 'Jobs')).toBeVisible()
    await expect(navBtn(page, 'Activity')).toBeVisible()
    // No permission → not in the sidebar at all.
    await expect(navBtn(page, 'Account Database')).toHaveCount(0)
    await expect(navBtn(page, 'Team')).toHaveCount(0)
    await expect(navBtn(page, 'Automations')).toHaveCount(0)
    await expect(navBtn(page, 'Settings')).toHaveCount(0)
  })
})

test.describe('Resource scope', () => {
  test('Operator sees only assigned phones in the registry', async ({ page }) => {
    await actAs(page, 'emp-03')
    await page.goto('/')
    await openSection(page, 'Phones')
    await expect(page.getByText('BACKUP 1', { exact: true })).toBeVisible()
    await expect(page.getByText('BACKUP 2', { exact: true })).toBeVisible()
    // Exist in the workspace but outside the operator's phone scope.
    await expect(page.getByText('CAROLINA 1', { exact: true })).toHaveCount(0)
    await expect(page.getByText('BACKUP 3', { exact: true })).toHaveCount(0)
  })
})

test.describe('Sensitive-data protection', () => {
  test('Owner can reveal credentials; default display is masked', async ({ page }) => {
    await actAs(page, 'emp-01')
    await page.goto('/')
    await openSection(page, 'Account Database')
    // Masked by default …
    await expect(page.getByText('••••••').first()).toBeVisible()
    // … and the reveal affordance is available to a permitted user.
    await expect(page.getByRole('button', { name: 'Reveal value' }).first()).toBeVisible()
  })

  test('Operator cannot reveal credentials', async ({ page }) => {
    await actAs(page, 'emp-03')
    await page.goto('/')
    await openSection(page, 'Account Database')
    // accounts.view but no reveal_* permission → no reveal affordance anywhere.
    await expect(page.getByRole('button', { name: 'Reveal value' })).toHaveCount(0)
  })
})

test.describe('Team / roles', () => {
  test('Manager sees Team but not the Roles & Permissions tab', async ({ page }) => {
    await actAs(page, 'emp-02')
    await page.goto('/')
    await openSection(page, 'Team')
    // Manager has team.view but not roles.view.
    await expect(page.getByRole('button', { name: /Roles & Permissions/i })).toHaveCount(0)
  })
})
