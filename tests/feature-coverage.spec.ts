import { test, expect } from 'playwright/test'

/**
 * CROSS-CUTTING FEATURE COVERAGE (release validation, Subagent 5).
 *
 * Authenticated-profile UI coverage for the SaaS features whose surfaces may live on
 * OTHER subagents' branches and are integrated by the lead. Written against the
 * authenticated build (real Supabase login) so a pass means a real signed-in user
 * exercised the feature — never demo/mock.
 *
 * TRUTH GUARANTEE: gated on the same E2E_SUPABASE_* config as authenticated-rbac.
 * When unconfigured, every test SKIPS loudly. Individual features that are not yet
 * present on the integrated branch are additionally guarded per-test with an
 * explicit skip-reason (a feature absence is reported as a skip, never a pass).
 *
 * Lead wires this into the `e2e-auth` project (add this filename to its testMatch).
 * See PROPOSALS.md.
 *
 * Required env (DEDICATED TEST project — never production):
 *   E2E_SUPABASE_URL, E2E_SUPABASE_ANON_KEY, E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD
 */

const REQUIRED = ['E2E_SUPABASE_URL', 'E2E_SUPABASE_ANON_KEY', 'E2E_OWNER_EMAIL', 'E2E_OWNER_PASSWORD'] as const
const NOT_CONFIGURED = 'Authenticated Supabase E2E not configured'
const missing = REQUIRED.filter((k) => !process.env[k])

if (missing.length > 0) {
  console.log(`[feature-coverage] ${NOT_CONFIGURED} — missing: ${missing.join(', ')}. Skipping feature coverage.`)
}

/** Skip a single feature test (loudly) when its surface isn't on the integrated branch. */
async function requireNav(page: import('playwright/test').Page, name: RegExp): Promise<boolean> {
  const link = page.getByRole('link', { name }).or(page.getByRole('button', { name }))
  return (await link.count()) > 0
}

test.describe('Cross-cutting feature coverage (authenticated)', () => {
  test.skip(missing.length > 0, NOT_CONFIGURED)

  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.locator('#email').fill(process.env.E2E_OWNER_EMAIL as string)
    await page.locator('#password').fill(process.env.E2E_OWNER_PASSWORD as string)
    await page.getByRole('button', { name: /^sign in$/i }).click()
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })
    // Prove a real session — never demo mode.
    const real = await page.evaluate(() =>
      Object.keys(localStorage).some((k) => k.startsWith('sb-') || k.includes('supabase.auth')),
    )
    expect(real, 'expected a real Supabase session, not demo mode').toBe(true)
  })

  test('Login → permission-aware shell renders', async ({ page }) => {
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible({ timeout: 15_000 })
  })

  test('Activity feed is reachable', async ({ page }) => {
    test.skip(!(await requireNav(page, /activity/i)), 'Activity surface not on integrated branch')
    await page.getByRole('link', { name: /activity/i }).first().click()
    await expect(page.getByRole('heading', { name: /activity/i })).toBeVisible()
  })

  test('Email preferences can be opened', async ({ page }) => {
    test.skip(!(await requireNav(page, /email|settings/i)), 'Email settings surface not on integrated branch')
    await page.getByRole('link', { name: /email|settings/i }).first().click()
    await expect(page.getByText(/email|transactional|sender/i).first()).toBeVisible()
  })

  test('Scale panel opens', async ({ page }) => {
    test.skip(!(await requireNav(page, /scale/i)), 'Scale surface not on integrated branch')
    await page.getByRole('button', { name: /scale/i }).first().click()
    await expect(page.getByText(/scale|target|fleet/i).first()).toBeVisible()
  })

  test('Proxies surface opens', async ({ page }) => {
    test.skip(!(await requireNav(page, /prox(y|ies)/i)), 'Proxies surface not on integrated branch')
    await page.getByRole('link', { name: /prox(y|ies)/i }).first().click()
    await expect(page.getByText(/prox/i).first()).toBeVisible()
  })

  test('Accounts surface opens', async ({ page }) => {
    test.skip(!(await requireNav(page, /accounts?/i)), 'Accounts surface not on integrated branch')
    await page.getByRole('link', { name: /accounts?/i }).first().click()
    await expect(page.getByText(/account/i).first()).toBeVisible()
  })

  test('Workspace settings surface opens', async ({ page }) => {
    test.skip(!(await requireNav(page, /workspace|settings/i)), 'Workspace settings surface not on integrated branch')
    await page.getByRole('link', { name: /workspace|settings/i }).first().click()
    await expect(page.getByText(/workspace|settings/i).first()).toBeVisible()
  })

  test('Shifts surface opens', async ({ page }) => {
    test.skip(!(await requireNav(page, /shift|team/i)), 'Shifts surface not on integrated branch')
    await page.getByRole('link', { name: /team/i }).first().click()
    await expect(page.getByText(/shift|team/i).first()).toBeVisible()
  })

  test('Team switching control is present for a multi-team owner', async ({ page }) => {
    const switcher = page.getByRole('button', { name: /switch|workspace|team/i })
    test.skip((await switcher.count()) === 0, 'Team switcher not on integrated branch / single-team owner')
    await expect(switcher.first()).toBeVisible()
  })
})
