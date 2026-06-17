import { defineConfig } from 'playwright/test'

/**
 * Authorization test suite. THREE explicit profiles — there is no implicit blend:
 *  - `engine`   : pure-function unit tests for the effective-access engine
 *                 (no browser, no server — runs in Node).
 *  - `e2e`      : the DEMO/mock profile. Role-scenario tests against a production
 *                 preview built with Supabase UNCONFIGURED, impersonating seeded
 *                 employees via the local session store. No real auth.
 *  - `e2e-auth` : the AUTHENTICATED profile. Real Supabase login → permission-aware
 *                 UI. Runs ONLY when the E2E_SUPABASE_* + owner credentials are
 *                 provided; otherwise every test SKIPS with a clear message. It can
 *                 never silently build or execute in demo mode (see webServer below).
 *
 * Scripts: `npm run test:engine` · `npm run test:e2e` (demo) · `npm run test:e2e:auth`.
 */

const argv = process.argv.join(' ')
const onlyEngine = argv.includes('--project=engine')
const onlyAuth = argv.includes('--project=e2e-auth')
const onlyMe = argv.includes('--project=e2e-me')
const skipServer = process.env.PW_SKIP_SERVER === '1' || onlyEngine

// Authenticated profile: prefer an externally-supplied, already-running app
// (E2E_BASE_URL — e.g. a preview deploy; NEVER production). Otherwise, when the
// Supabase test vars are present, build a Supabase-configured preview locally.
const E2E_BASE_URL = process.env.E2E_BASE_URL
const authBuildConfigured = Boolean(process.env.E2E_SUPABASE_URL && process.env.E2E_SUPABASE_ANON_KEY)
const E2E_ME_BASE_URL = process.env.E2E_ME_BASE_URL
const meBuildConfigured = Boolean(process.env.E2E_ME_SUPABASE_URL && process.env.E2E_ME_SUPABASE_ANON_KEY && process.env.E2E_ME_API_URL)

const LAUNCH = { args: ['--use-gl=swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] }

// DEMO build: Supabase is forced UNCONFIGURED so the seeded-employee impersonation
// applies. The empty values take precedence over any developer .env.local, so this
// profile can't silently become an auth-gated build (which would 302 to /login).
const demoServer = {
  command: 'npm run build && npm run preview -- --port 4173 --strictPort',
  url: 'http://localhost:4173',
  env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '', VITE_USE_BACKEND: '' },
  reuseExistingServer: true,
  timeout: 180_000,
}

// AUTHENTICATED build: Supabase IS configured from the E2E_* test vars (a dedicated
// test project, never prod). Only started for `--project=e2e-auth` with no external
// E2E_BASE_URL. If the vars are absent, NO server is built — the spec skips instead,
// so a missing config can never masquerade as an authenticated pass.
const authServer = {
  command: 'npm run build && npm run preview -- --port 4273 --strictPort',
  url: 'http://localhost:4273',
  env: {
    VITE_SUPABASE_URL: process.env.E2E_SUPABASE_URL ?? '',
    VITE_SUPABASE_ANON_KEY: process.env.E2E_SUPABASE_ANON_KEY ?? '',
    VITE_USE_BACKEND: process.env.E2E_USE_BACKEND ?? '',
    VITE_API_URL: process.env.E2E_API_URL ?? '',
    VITE_WS_URL: process.env.E2E_WS_URL ?? '',
  },
  reuseExistingServer: true,
  timeout: 180_000,
}

// AUTHORITATIVE me-mode build: VITE_AUTH_SOURCE=me so the gate + role come from the
// backend GET /v1/me (Prisma). Supabase still provides login. DEDICATED TEST project +
// test backend only — NEVER production. Built only for --project=e2e-me with no external
// E2E_ME_BASE_URL; absent config → no server, the spec skips.
const meServer = {
  command: 'npm run build && npm run preview -- --port 4373 --strictPort',
  url: 'http://localhost:4373',
  env: {
    VITE_AUTH_SOURCE: 'me',
    VITE_SUPABASE_URL: process.env.E2E_ME_SUPABASE_URL ?? '',
    VITE_SUPABASE_ANON_KEY: process.env.E2E_ME_SUPABASE_ANON_KEY ?? '',
    VITE_USE_BACKEND: '1',
    VITE_API_URL: process.env.E2E_ME_API_URL ?? '',
    VITE_WS_URL: process.env.E2E_ME_WS_URL ?? '',
  },
  reuseExistingServer: true,
  timeout: 180_000,
}

const webServer = skipServer
  ? undefined
  : onlyMe
    ? E2E_ME_BASE_URL || !meBuildConfigured
      ? undefined // external app, or unconfigured (spec skips) — build nothing
      : meServer
    : onlyAuth
      ? E2E_BASE_URL || !authBuildConfigured
        ? undefined // external app, or unconfigured (spec skips) — build nothing
        : authServer
      : demoServer

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  projects: [
    // Pure-function unit tests (no browser, no server): the access engine, the
    // fleet physics solver, the auth/email routing + client builders.
    { name: 'engine', testMatch: /(authz-engine|fleet-physics|email-engine|control-command|email-settings-client|auth-redirect|auth-route|authz-route|no-debug-ingest|selected-team|shift-overlay|secret-scan)\.spec\.ts/ },
    {
      // DEMO/mock profile — seeded-employee impersonation, Supabase unconfigured.
      name: 'e2e',
      testMatch: /authz\.spec\.ts/,
      use: { baseURL: 'http://localhost:4173', headless: true, launchOptions: LAUNCH },
    },
    {
      // AUTHENTICATED profile — real Supabase login. Skips unless configured.
      name: 'e2e-auth',
      testMatch: /(authenticated-rbac|feature-coverage)\.spec\.ts/,
      use: { baseURL: E2E_BASE_URL || 'http://localhost:4273', headless: true, launchOptions: LAUNCH },
    },
    {
      // AUTHORITATIVE me-mode profile — VITE_AUTH_SOURCE=me, gate+role from /v1/me.
      // Skips unless E2E_ME_* configured (dedicated test project, never prod).
      name: 'e2e-me',
      testMatch: /authoritative-me-mode\.spec\.ts/,
      use: { baseURL: E2E_ME_BASE_URL || 'http://localhost:4373', headless: true, launchOptions: LAUNCH },
    },
    {
      name: 'capture',
      testMatch: /capture\.spec\.ts/,
      use: { baseURL: 'http://localhost:4173', headless: true, viewport: { width: 1440, height: 900 }, launchOptions: LAUNCH },
    },
    {
      // Live diagnostics: console errors, uncaught exceptions, axe a11y, responsive overflow.
      name: 'audit',
      testMatch: /audit-.*\.spec\.ts/,
      use: { baseURL: 'http://localhost:4173', headless: true, viewport: { width: 1440, height: 900 }, launchOptions: LAUNCH },
    },
  ],
  // Engine tests need no server. Skip the build+preview when only that project runs
  // (or PW_SKIP_SERVER=1) so unit tests stay fast and portable. The demo and
  // authenticated profiles build with DIFFERENT Supabase configs (see above).
  webServer,
})
