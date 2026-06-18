import { test, expect } from 'playwright/test'

/**
 * AUTHENTICATED Supabase RBAC E2E — the real auth path (UI login → live session →
 * permission-aware UI), as opposed to the `e2e` (authz.spec.ts) DEMO profile, which
 * impersonates seeded employees via the local session store with no real auth.
 *
 * TRUTH GUARANTEE: this profile must NEVER silently run in demo/mock mode. When the
 * required Supabase test configuration is absent, every test SKIPS with a clear
 * message and nothing is reported as an authenticated pass. (See playwright.config.ts:
 * when these vars are unset, no Supabase-configured web server is built either, so a
 * skip can never be confused with a demo-mode "pass".)
 *
 * Required env (set in the shell / CI secrets — NEVER commit these values):
 *   E2E_SUPABASE_URL        Supabase project URL  — a DEDICATED TEST project, NOT production
 *   E2E_SUPABASE_ANON_KEY   anon public key for that project
 *   E2E_OWNER_EMAIL         a seeded owner account in that project
 *   E2E_OWNER_PASSWORD      that account's password
 *
 * Optional env:
 *   E2E_BASE_URL  run against an already-running Supabase-configured app (e.g. a preview
 *                 deploy). Do NOT point this at production. When unset, the config builds a
 *                 Supabase-configured preview locally on :4273 from E2E_SUPABASE_*.
 */

const REQUIRED = ['E2E_SUPABASE_URL', 'E2E_SUPABASE_ANON_KEY', 'E2E_OWNER_EMAIL', 'E2E_OWNER_PASSWORD'] as const
const NOT_CONFIGURED = 'Authenticated Supabase E2E not configured'
const missing = REQUIRED.filter((k) => !process.env[k])

if (missing.length > 0) {
  // Visible on stdout (the report also shows the per-test skip reason). Loud, never silent.
  console.log(`[e2e-auth] ${NOT_CONFIGURED} — missing: ${missing.join(', ')}. Skipping authenticated E2E.`)
}

test.describe('Authenticated Supabase RBAC', () => {
  // Hard guard: if configuration is missing, skip — do NOT execute in demo mode.
  test.skip(missing.length > 0, NOT_CONFIGURED)

  test.beforeEach(async ({ page }) => {
    // A real login against the configured Supabase project. The presence of /login
    // already proves the build is auth-enabled (the demo build never gates on it).
    await page.goto('/login')
    await page.locator('#email').fill(process.env.E2E_OWNER_EMAIL as string)
    await page.locator('#password').fill(process.env.E2E_OWNER_PASSWORD as string)
    await page.getByRole('button', { name: /^sign in$/i }).click()
    // Authenticated users land on the dashboard or onboarding — never back at /login.
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })
  })

  test('a real authenticated session is established (not demo mode)', async ({ page }) => {
    // A genuine Supabase session persists a token under an sb-*/supabase key; demo
    // mode has none. This is the assertion that makes a demo-mode masquerade fail.
    const hasSession = await page.evaluate(() =>
      Object.keys(localStorage).some((k) => k.startsWith('sb-') || k.includes('supabase.auth')),
    )
    expect(hasSession, 'expected a persisted Supabase auth session token').toBe(true)
  })

  test('the authenticated owner reaches the permission-aware dashboard', async ({ page }) => {
    // Real role/permission-driven shell (the primary nav) renders for the signed-in owner.
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible({ timeout: 15_000 })
  })
})
