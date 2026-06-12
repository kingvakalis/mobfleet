/**
 * Interaction test suite: fleet graph (drag/pan/select/persist/lock/filters),
 * sidebar modes, appearance persistence, phone stabilization.
 * Run against a dev server: APP_URL=http://localhost:5176 node scripts/test-interactions.mjs
 */
import { chromium } from 'playwright'

const URL = process.env.APP_URL ?? 'http://localhost:5176'
let pass = 0, fail = 0
const ok = (name, cond) => {
  if (cond) { pass++; console.log('PASS', name) }
  else { fail++; console.log('FAIL', name) }
}

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1700, height: 950 } })
page.on('pageerror', e => console.log('[pageerror]', e.message))

const waitGraph = async () => {
  await page.waitForSelector('.react-flow__node', { timeout: 40000 })
  await page.waitForTimeout(1200)
}
await page.goto(URL, { waitUntil: 'networkidle' })
await waitGraph()

const nodeSel = '.react-flow__node[data-id]:not([data-id="orchestrator"])'
const getTransform = (loc) => loc.evaluate(n => n.style.transform)
const layout = () => page.evaluate(() => JSON.parse(localStorage.getItem('mobfleet-fleet-layout-v2') ?? 'null'))

// ── 1. Node drag: moves only that node, persists, survives reload ────────────
let draggedId, draggedTransform
{
  const first = page.locator(nodeSel).first()
  const second = page.locator(nodeSel).nth(1)
  draggedId = await first.getAttribute('data-id')
  const before1 = await getTransform(first)
  const before2 = await getTransform(second)
  const box = await first.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 170, box.y + 120, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(700)
  draggedTransform = await getTransform(first)
  ok('drag moves the dragged phone', before1 !== draggedTransform)
  ok('drag leaves other phones in place', before2 === (await getTransform(second)))
  const l = await layout()
  ok('dragged position persisted (layout v2)', Boolean(l?.devices?.[draggedId]))
  ok('drag did not open phone control', !(await page.getByText('QUICK CONTROLS').isVisible().catch(() => false)))
}

// ── 2. Orchestrator drag persists ─────────────────────────────────────────────
{
  const orch = page.locator('.react-flow__node[data-id="orchestrator"]')
  const before = await getTransform(orch)
  const box = await orch.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2 + 60, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(700)
  ok('orchestrator drags independently', before !== (await getTransform(orch)))
  const l = await layout()
  ok('orchestrator position persisted', Boolean(l?.orchestrator))
}

// ── 3. Canvas pan + viewport persistence ─────────────────────────────────────
{
  const vpBefore = await page.locator('.react-flow__viewport').evaluate(n => n.style.transform)
  await page.mouse.move(400, 700) // empty canvas area
  await page.mouse.down()
  await page.mouse.move(620, 600, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(700)
  const vpAfter = await page.locator('.react-flow__viewport').evaluate(n => n.style.transform)
  ok('dragging empty canvas pans the viewport', vpBefore !== vpAfter)
  const l = await layout()
  ok('viewport persisted', Boolean(l?.viewport))
}

// ── 4. Hover shows no card; click selects + shows card; Escape clears ────────
{
  const first = page.locator(nodeSel).first()
  await first.hover()
  await page.waitForTimeout(450)
  ok('hover does NOT show device info', (await page.locator('.react-flow').getByText('Uptime').count()) === 0)
  await first.click()
  await page.waitForTimeout(500)
  ok('click selects and shows contextual card', (await page.locator('.react-flow').getByText('Uptime').count()) > 0)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  ok('Escape clears selection card', (await page.locator('.react-flow').getByText('Uptime').count()) === 0)
}

// ── 5. Filters: status chip + count + dim; clear restores ────────────────────
{
  await page.getByRole('button', { name: 'Status', exact: true }).click()
  await page.waitForTimeout(300)
  await page.locator('button', { hasText: 'BUSY' }).first().click()
  await page.waitForTimeout(600)
  ok('filter chips show match count', await page.getByText(/of 40 match/).isVisible())
  const dimmedCount = await page.locator(`${nodeSel}`).evaluateAll(ns => ns.filter(n => parseFloat(getComputedStyle(n.firstElementChild).opacity) < 0.5).length)
  ok('non-matching phones are dimmed', dimmedCount > 0)
  await page.getByRole('button', { name: 'Clear all' }).click()
  await page.waitForTimeout(600)
  const dimmedAfter = await page.locator(`${nodeSel}`).evaluateAll(ns => ns.filter(n => parseFloat(getComputedStyle(n.firstElementChild).opacity) < 0.5).length)
  ok('clearing filters restores all phones', dimmedAfter === 0)
  const l = await layout()
  ok('filtering never reset custom positions', Boolean(l?.devices?.[draggedId]))
}

// ── 6. Lock layout prevents node dragging ────────────────────────────────────
{
  await page.getByRole('button', { name: /^Lock$|Lock layout/ }).first().click()
  await page.waitForTimeout(300)
  const first = page.locator(`.react-flow__node[data-id="${draggedId}"]`)
  const before = await getTransform(first)
  const box = await first.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 120, box.y + 80, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  ok('layout lock prevents node movement', before === (await getTransform(first)))
  ok('lock indicator visible', await page.getByText('Layout locked').isVisible())
  await page.getByRole('button', { name: /Locked|Unlock layout/ }).first().click()
  await page.waitForTimeout(300)
}

// ── 7. Reload: node position survives ────────────────────────────────────────
{
  await page.reload({ waitUntil: 'networkidle' })
  await waitGraph()
  const moved = page.locator(`.react-flow__node[data-id="${draggedId}"]`)
  ok('node position survives reload', (await getTransform(moved)) === draggedTransform)
}

// ── 8. Double-click opens phone control ──────────────────────────────────────
{
  const first = page.locator(`.react-flow__node[data-id="${draggedId}"]`)
  await first.dblclick()
  const opened = await page.getByText('QUICK CONTROLS').waitFor({ timeout: 20000 }).then(() => true).catch(() => false)
  ok('double-click opens phone control', opened)
}

// ── 9. Stabilize phone: toggle, persists ─────────────────────────────────────
{
  const btn = page.getByRole('button', { name: /Stabilize/i }).first()
  await btn.click()
  await page.waitForTimeout(400)
  const s1 = await page.evaluate(() => JSON.parse(localStorage.getItem('mobfleet-settings')).state.stabilizePhone)
  ok('stabilize toggle persists ON', s1 === true)
  await page.getByRole('button', { name: /Stabilized/i }).first().click()
  await page.waitForTimeout(300)
  const s2 = await page.evaluate(() => JSON.parse(localStorage.getItem('mobfleet-settings')).state.stabilizePhone)
  ok('stabilize toggle persists OFF', s2 === false)
}

// ── 10. Sidebar: collapse via Ctrl+B, persists ───────────────────────────────
{
  const aside = page.locator('aside').first()
  const wBefore = (await aside.boundingBox()).width
  await page.keyboard.press('Control+b')
  await page.waitForTimeout(500)
  const wAfter = (await aside.boundingBox()).width
  ok('Ctrl+B collapses sidebar to rail', wAfter < wBefore)
  const mode = await page.evaluate(() => JSON.parse(localStorage.getItem('mobfleet-settings')).state.sidebarMode)
  ok('sidebar mode persists', mode === 'collapsed')
  await page.keyboard.press('Control+b')
  await page.waitForTimeout(400)
}

// ── 11. Theme: switch + save + survives reload, accent applies ───────────────
{
  await page.getByRole('button', { name: 'SETTINGS' }).click()
  await page.waitForTimeout(1200)
  await page.getByRole('radio', { name: /Midnight/ }).click()
  await page.getByRole('radio', { name: /Blue/ }).click()
  await page.getByRole('button', { name: /^Save$/i }).click()
  await page.waitForTimeout(500)
  const theme = await page.evaluate(() => document.documentElement.dataset.theme)
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())
  ok('theme applied globally (data-theme)', theme === 'midnight')
  ok('accent variable updated', accent === '#60a5fa')
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const themeAfter = await page.evaluate(() => document.documentElement.dataset.theme)
  ok('theme survives reload (no flash of default)', themeAfter === 'midnight')
  // restore defaults for screenshots
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('mobfleet-settings'))
    raw.state.theme = 'obsidian'; raw.state.accent = 'teal'
    localStorage.setItem('mobfleet-settings', JSON.stringify(raw))
  })
}

console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
