import { defineConfig } from 'playwright/test'

/**
 * Authorization test suite.
 *  - `engine`  : pure-function unit tests for the effective-access engine
 *                (no browser, no server — runs in Node).
 *  - `e2e`     : role-scenario tests against a production preview build,
 *                impersonating seeded employees via the session store.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  projects: [
    // Pure-function unit tests (no browser, no server): the access engine and
    // the fleet physics solver.
    { name: 'engine', testMatch: /(authz-engine|fleet-physics|email-engine|control-command|email-settings-client|auth-redirect)\.spec\.ts/ },
    {
      name: 'e2e',
      testMatch: /authz\.spec\.ts/,
      use: {
        baseURL: 'http://localhost:4173',
        headless: true,
        launchOptions: { args: ['--use-gl=swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] },
      },
    },
    {
      name: 'capture',
      testMatch: /capture\.spec\.ts/,
      use: {
        baseURL: 'http://localhost:4173',
        headless: true,
        viewport: { width: 1440, height: 900 },
        launchOptions: { args: ['--use-gl=swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] },
      },
    },
    {
      // Live diagnostics: console errors, uncaught exceptions, axe a11y, responsive overflow.
      name: 'audit',
      testMatch: /audit-.*\.spec\.ts/,
      use: {
        baseURL: 'http://localhost:4173',
        headless: true,
        viewport: { width: 1440, height: 900 },
        launchOptions: { args: ['--use-gl=swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] },
      },
    },
  ],
  // Engine tests need no server. Skip the build+preview when only that project
  // runs (or when PW_SKIP_SERVER=1) so unit tests stay fast and portable.
  webServer: (process.env.PW_SKIP_SERVER === '1' || process.argv.join(' ').includes('--project=engine')) ? undefined : {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
})
