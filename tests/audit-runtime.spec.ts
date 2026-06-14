import { test, expect, type Page } from 'playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * Live runtime diagnostics (owner emp-01): captures console errors, uncaught
 * exceptions, axe accessibility violations, and mobile horizontal overflow
 * across every view. Diagnostic — logs findings; hard-fails only on uncaught
 * exceptions and critical a11y violations.
 */

const SESSION_KEY = 'mobfleet-session-v1'

async function actAsOwner(page: Page) {
  await page.addInitScript(
    (key) => localStorage.setItem(key, JSON.stringify({ state: { actingId: 'emp-01' }, version: 0 })),
    SESSION_KEY,
  )
}

const VIEWS = ['Fleet', 'Phones', 'Account Database', 'Groups', 'Team', 'Automations', 'Jobs', 'Activity', 'Settings']
const nav = (page: Page) => page.getByRole('navigation', { name: 'Primary' })
async function open(page: Page, label: string) {
  await nav(page).getByRole('button', { name: label, exact: true }).click()
  await page.waitForTimeout(650)
}

test('console errors + uncaught exceptions across all views', async ({ page }) => {
  const consoleErrors: string[] = []
  const consoleWarnings: string[] = []
  const pageErrors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
    else if (m.type() === 'warning') consoleWarnings.push(m.text())
  })
  page.on('pageerror', (e) => pageErrors.push(`${e.name}: ${e.message}`))

  await actAsOwner(page)
  await page.goto('/')
  await page.waitForTimeout(1200)
  for (const v of VIEWS) await open(page, v)
  // Extra interaction coverage: open a phone-control session + command palette.
  await open(page, 'Phones')
  const control = page.getByRole('button', { name: 'CONTROL →' }).first()
  if (await control.count()) { await control.click(); await page.waitForTimeout(800) }

  const uniq = (a: string[]) => [...new Set(a)]
  console.log('=== CONSOLE ERRORS ===\n' + JSON.stringify(uniq(consoleErrors), null, 2))
  console.log('=== CONSOLE WARNINGS ===\n' + JSON.stringify(uniq(consoleWarnings), null, 2))
  console.log('=== UNCAUGHT PAGE ERRORS ===\n' + JSON.stringify(uniq(pageErrors), null, 2))

  // Uncaught exceptions are unambiguous bugs — fail on them.
  expect(uniq(pageErrors), 'uncaught exceptions during navigation').toEqual([])
})

interface AxeRow { view: string; id: string; impact: string | undefined; nodes: number }

test('axe accessibility scan (WCAG 2a/2aa) across key views', async ({ page }) => {
  await actAsOwner(page)
  await page.goto('/')
  await page.waitForTimeout(900)
  const targets = ['Fleet', 'Phones', 'Account Database', 'Team', 'Jobs', 'Activity', 'Settings']
  const all: AxeRow[] = []
  for (const label of targets) {
    if (label !== 'Fleet') await open(page, label)
    else await page.waitForTimeout(400)
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    for (const v of results.violations) all.push({ view: label, id: v.id, impact: v.impact, nodes: v.nodes.length })
    // Diagnostic: dump the actual failing color pairs for color-contrast so the
    // worst-offending classes can be targeted (logged, not asserted).
    const cc = results.violations.find((v) => v.id === 'color-contrast')
    if (cc) {
      const detail = cc.nodes.slice(0, 8).map((n) => {
        const d = n.any?.[0]?.data as { fgColor?: string; bgColor?: string; contrastRatio?: number; expectedContrastRatio?: string; fontSize?: string } | undefined
        return { target: String(n.target?.[0] ?? ''), fg: d?.fgColor, bg: d?.bgColor, ratio: d?.contrastRatio, need: d?.expectedContrastRatio, size: d?.fontSize }
      })
      console.log(`--- color-contrast detail (${label}) ---\n` + JSON.stringify(detail, null, 2))
    }
  }
  console.log('=== AXE VIOLATIONS (by view) ===\n' + JSON.stringify(all, null, 2))
  const bySeverity = (imp: string) => all.filter((x) => x.impact === imp).length
  console.log(`=== AXE SUMMARY === critical=${bySeverity('critical')} serious=${bySeverity('serious')} moderate=${bySeverity('moderate')} minor=${bySeverity('minor')}`)
  // Critical violations are hard failures; serious/moderate reported for triage.
  expect(all.filter((x) => x.impact === 'critical'), 'critical a11y violations').toEqual([])
})

test('responsive: report horizontal overflow at mobile width (390px)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await actAsOwner(page)
  await page.goto('/')
  await page.waitForTimeout(900)
  const offenders: { view: string; scrollW: number; innerW: number }[] = []
  for (const label of ['Fleet', 'Phones', 'Account Database', 'Team', 'Jobs', 'Settings']) {
    if (label !== 'Fleet') await open(page, label)
    const m = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, i: window.innerWidth }))
    if (m.s > m.i + 2) offenders.push({ view: label, scrollW: m.s, innerW: m.i })
  }
  console.log('=== MOBILE HORIZONTAL OVERFLOW (page-level) ===\n' + JSON.stringify(offenders, null, 2))
  // Report-only: in-container table scroll is acceptable; this flags page-level overflow to review.
})
