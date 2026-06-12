/**
 * Interaction test suite: fleet graph (drag/pan/select/persist/lock/filters),
 * core group-drag, device sidebar, pin, appearance, stabilization.
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
const drawerSel = '[role="dialog"][aria-label^="Device"]'
const getTransform = (loc) => loc.evaluate(n => n.style.transform)
const parseXY = (t) => {
  const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(t)
  return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: 0, y: 0 }
}
const layout = () => page.evaluate(() => JSON.parse(localStorage.getItem('mobfleet-fleet-layout-v2') ?? 'null'))

// ── 1. Node drag: moves only that node, persists, no sidebar opens ───────────
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
  ok('drag did not open the device sidebar', (await page.locator(drawerSel).count()) === 0)
}

// ── 2. CORE drag carries the whole constellation ──────────────────────────────
{
  const orch = page.locator('.react-flow__node[data-id="orchestrator"]')
  const dev = page.locator(`.react-flow__node[data-id="${draggedId}"]`)
  const orchBefore = parseXY(await getTransform(orch))
  const devBefore = parseXY(await getTransform(dev))
  const box = await orch.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 130, box.y + box.height / 2 + 70, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(800)
  const orchAfter = parseXY(await getTransform(orch))
  const devAfter = parseXY(await getTransform(dev))
  const dOrch = { x: orchAfter.x - orchBefore.x, y: orchAfter.y - orchBefore.y }
  const dDev = { x: devAfter.x - devBefore.x, y: devAfter.y - devBefore.y }
  ok('core drag moves the orchestrator', Math.abs(dOrch.x) > 30)
  ok('phones move by the SAME offset as the core', Math.abs(dOrch.x - dDev.x) < 2 && Math.abs(dOrch.y - dDev.y) < 2)
  const l = await layout()
  ok('orchestrator position persisted', Boolean(l?.orchestrator))
  ok('all carried phone positions persisted', Object.keys(l?.devices ?? {}).length >= 40)
  draggedTransform = await getTransform(dev)
}

// ── 3. Canvas pan + viewport persistence ─────────────────────────────────────
{
  const vpBefore = await page.locator('.react-flow__viewport').evaluate(n => n.style.transform)
  await page.mouse.move(380, 760)
  await page.mouse.down()
  await page.mouse.move(600, 660, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(700)
  const vpAfter = await page.locator('.react-flow__viewport').evaluate(n => n.style.transform)
  ok('dragging empty canvas pans the viewport', vpBefore !== vpAfter)
  const l = await layout()
  ok('viewport persisted', Boolean(l?.viewport))
}

// ── 4. Hover: nothing. Click: device sidebar. Escape: closes ─────────────────
{
  const first = page.locator(`.react-flow__node[data-id="${draggedId}"]`)
  await first.hover()
  await page.waitForTimeout(450)
  ok('hover does NOT open the sidebar', (await page.locator(drawerSel).count()) === 0)
  await first.click()
  const opened = await page.locator(drawerSel).waitFor({ timeout: 15000 }).then(() => true).catch(() => false)
  ok('single click opens the device sidebar', opened)
  ok('sidebar did not navigate away from fleet', (await page.getByText('Report Problem').count()) === 0)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  ok('Escape closes the sidebar', (await page.locator(drawerSel).count()) === 0)
}

// ── 5. Double-click also opens the sidebar (never navigates) ─────────────────
{
  const first = page.locator(`.react-flow__node[data-id="${draggedId}"]`)
  await first.dblclick()
  const opened = await page.locator(drawerSel).waitFor({ timeout: 15000 }).then(() => true).catch(() => false)
  ok('double-click opens the device sidebar', opened)
  ok('double-click does not open phone control', (await page.getByText('Report Problem').count()) === 0)
}

// ── 6. Pin: empty-canvas click closes unpinned, keeps pinned open ────────────
{
  // Find a guaranteed-empty pane spot: top-left corner away from HUD and nodes.
  const paneClick = () => page.locator('.react-flow__pane').click({ position: { x: 30, y: 560 }, force: true })
  // Unpinned (default): canvas click closes the sidebar.
  await paneClick()
  await page.waitForTimeout(500)
  ok('unpinned sidebar closes on canvas click', (await page.locator(drawerSel).count()) === 0)
  // Reopen, pin, canvas click keeps it open.
  await page.locator(`.react-flow__node[data-id="${draggedId}"]`).click()
  await page.locator(drawerSel).waitFor({ timeout: 15000 })
  await page.locator('button[title^="Pin"]').first().click()
  await page.waitForTimeout(300)
  await paneClick()
  await page.waitForTimeout(500)
  ok('pinned sidebar stays open on canvas click', (await page.locator(drawerSel).count()) === 1)
  await page.locator('button[title^="Unpin"]').first().click()
  await page.waitForTimeout(200)
  await paneClick()
  await page.waitForTimeout(400)
}

// ── 7. Sidebar "Full Control" action opens phone control ─────────────────────
{
  await page.locator(`.react-flow__node[data-id="${draggedId}"]`).click()
  await page.locator(drawerSel).waitFor({ timeout: 15000 })
  await page.getByRole('button', { name: /Full Control/i }).click()
  const opened = await page.getByText('Report Problem').waitFor({ timeout: 20000 }).then(() => true).catch(() => false)
  ok('Full Control action opens phone control', opened)
  await page.getByRole('button', { name: 'FLEET' }).click()
  await waitGraph()
}

// ── 8. Filters: status chip + count + dim; clear restores ────────────────────
{
  await page.getByRole('button', { name: 'Status', exact: true }).click()
  await page.waitForTimeout(300)
  await page.locator('button', { hasText: 'BUSY' }).first().click()
  await page.waitForTimeout(600)
  ok('filter chips show match count', await page.getByText(/of 40 match/).isVisible())
  const dimmedCount = await page.locator(nodeSel).evaluateAll(ns => ns.filter(n => parseFloat(getComputedStyle(n.firstElementChild).opacity) < 0.5).length)
  ok('non-matching phones are dimmed', dimmedCount > 0)
  await page.getByRole('button', { name: 'Clear all' }).click()
  await page.waitForTimeout(600)
  const l = await layout()
  ok('filtering never reset custom positions', Boolean(l?.devices?.[draggedId]))
}

// ── 9. Lock layout prevents node dragging ────────────────────────────────────
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
  await page.getByRole('button', { name: /Locked|Unlock layout/ }).first().click()
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
}

// ── 10. Reload: positions survive ────────────────────────────────────────────
{
  await page.reload({ waitUntil: 'networkidle' })
  await waitGraph()
  const moved = page.locator(`.react-flow__node[data-id="${draggedId}"]`)
  ok('node position survives reload', (await getTransform(moved)) === draggedTransform)
}

// ── 11. Account Database: shared system + working flows ─────────────────────
{
  await page.getByRole('button', { name: 'ACCOUNT DATABASE' }).click()
  await page.waitForTimeout(1800)
  ok('accounts page renders new header', await page.getByText('Data Vault').isVisible())
  // open detail drawer
  await page.locator('tbody tr').first().click()
  const drawer = await page.locator('[role="dialog"][aria-label^="Account"]').waitFor({ timeout: 15000 }).then(() => true).catch(() => false)
  ok('account row opens detail drawer', drawer)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  // add-account modal validation
  await page.getByRole('button', { name: /Add Account/i }).first().click()
  await page.waitForTimeout(400)
  const createBtn = page.getByRole('button', { name: /Create Account/i })
  ok('add-account save disabled until valid', await createBtn.isDisabled())
  await page.keyboard.press('Escape')
  await page.locator('[aria-label="Close"]').first().click().catch(() => {})
}

console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
