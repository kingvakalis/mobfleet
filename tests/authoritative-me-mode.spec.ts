import { test, expect } from 'playwright/test'

/**
 * AUTHORITATIVE "me-mode" PROFILE (release validation, Subagent 5).
 *
 * The third explicit profile (alongside `e2e` = demo/mock and `e2e-auth` =
 * authenticated-Supabase). Here the gate + role are derived from the authoritative
 * backend `GET /v1/me` (Prisma) with VITE_AUTH_SOURCE=me, while Supabase still
 * provides the login session. See src/auth/auth-source.ts.
 *
 * TRUTH GUARANTEE: like e2e-auth, this MUST NEVER silently run in demo mode. It is
 * gated on a DEDICATED test Supabase project + a reachable backend exposing /v1/me.
 * When unconfigured, every test SKIPS loudly. A skip is never a pass.
 *
 * Required env (DEDICATED TEST project + backend — NEVER production):
 *   E2E_ME_SUPABASE_URL        Supabase project URL (test project)
 *   E2E_ME_SUPABASE_ANON_KEY   anon public key
 *   E2E_ME_OWNER_EMAIL         seeded owner in that project, also a Prisma member
 *   E2E_ME_OWNER_PASSWORD      that account's password
 *   E2E_ME_API_URL             backend base URL serving /v1/me (test backend)
 *
 * Optional:
 *   E2E_ME_BASE_URL  run against an already-running me-mode app (preview, never prod).
 *
 * To make this profile EXECUTE (post-integration), the lead adds the `e2e-me`
 * Playwright project + webServer building with VITE_AUTH_SOURCE=me. Until then it is
 * defined here and skips. See PROPOSALS.md.
 */

const REQUIRED = [
  'E2E_ME_SUPABASE_URL',
  'E2E_ME_SUPABASE_ANON_KEY',
  'E2E_ME_OWNER_EMAIL',
  'E2E_ME_OWNER_PASSWORD',
  'E2E_ME_API_URL',
] as const
const NOT_CONFIGURED = 'Authoritative me-mode E2E not configured'
const missing = REQUIRED.filter((k) => !process.env[k])

if (missing.length > 0) {
  console.log(`[e2e-me] ${NOT_CONFIGURED} — missing: ${missing.join(', ')}. Skipping me-mode E2E.`)
}

test.describe('Authoritative me-mode (VITE_AUTH_SOURCE=me)', () => {
  test.skip(missing.length > 0, NOT_CONFIGURED)

  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.locator('#email').fill(process.env.E2E_ME_OWNER_EMAIL as string)
    await page.locator('#password').fill(process.env.E2E_ME_OWNER_PASSWORD as string)
    await page.getByRole('button', { name: /^sign in$/i }).click()
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })
  })

  test('a real Supabase session is established (not demo mode)', async ({ page }) => {
    const hasSession = await page.evaluate(() =>
      Object.keys(localStorage).some((k) => k.startsWith('sb-') || k.includes('supabase.auth')),
    )
    expect(hasSession, 'expected a persisted Supabase auth session token').toBe(true)
  })

  test('the app build is wired to the authoritative /v1/me source', async ({ page }) => {
    // The me-mode build issues a GET to the backend /v1/me; observing that request
    // distinguishes this from the demo and supabase-data profiles.
    const meHit = page.waitForResponse(
      (r) => /\/v1\/me\b/.test(r.url()) && r.request().method() === 'GET',
      { timeout: 15_000 },
    )
    await page.reload()
    const res = await meHit
    expect(res.status(), 'GET /v1/me should authorize the owner').toBeLessThan(400)
  })

  test('the authoritative owner reaches the permission-aware dashboard', async ({ page }) => {
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible({ timeout: 15_000 })
  })
})
