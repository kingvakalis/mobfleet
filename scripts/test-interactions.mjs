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
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

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
  await page.waitForTimeout(2100) // settle + batched save
  draggedTransform = await getTransform(first)
  ok('drag moves the dragged phone', dist(parseXY(before1), parseXY(draggedTransform)) > 80)
  // Physics: neighbors may breathe/settle a few px, but must not be displaced.
  ok('drag does not displace other phones', dist(parseXY(before2), parseXY(await getTransform(second))) < 30)
  const l = await layout()
  ok('dragged position persisted (layout v2)', Boolean(l?.devices?.[draggedId]))
  ok('drag did not open the device sidebar', (await page.locator(drawerSel).count()) === 0)
}

// ── 2. CORE drag: spring physics, NOT rigid translation ──────────────────────
{
  const orch = page.locator('.react-flow__node[data-id="orchestrator"]')
  const pinnedDev = page.locator(`.react-flow__node[data-id="${draggedId}"]`)   // pinned in test 1
  const freeDev = page.locator(nodeSel).nth(2)                                   // unpinned follower
  const orchBefore = parseXY(await getTransform(orch))
  const pinnedBefore = parseXY(await getTransform(pinnedDev))
  const freeBefore = parseXY(await getTransform(freeDev))
  const box = await orch.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2 + 80, { steps: 16 })
  await page.mouse.up()
  await page.waitForTimeout(1800) // let springs pull + settle
  const orchAfter = parseXY(await getTransform(orch))
  const pinnedAfter = parseXY(await getTransform(pinnedDev))
  const freeAfter = parseXY(await getTransform(freeDev))
  const dOrch = { x: orchAfter.x - orchBefore.x, y: orchAfter.y - orchBefore.y }
  const dFree = { x: freeAfter.x - freeBefore.x, y: freeAfter.y - freeBefore.y }
  ok('core drag moves the orchestrator', Math.abs(dOrch.x) > 40)
  // Spring follow: unpinned phones are PULLED toward the core's motion…
  const along = (dFree.x * dOrch.x + dFree.y * dOrch.y) / Math.hypot(dOrch.x, dOrch.y)
  ok('unpinned phones follow elastically (spring pull)', along > 25)
  // …but NOT by the identical rigid offset (independent reactions).
  ok('phones do NOT move by the identical rigid offset', dist(dOrch, dFree) > 8)
  // Pinned phones hold their anchors.
  ok('pinned phone holds its position during core drag', dist(pinnedBefore, pinnedAfter) < 14)
  await page.waitForTimeout(1200) // batched settle-save
  const l = await layout()
  ok('orchestrator position persisted', Boolean(l?.orchestrator))
  ok('settled phone positions persisted', Object.keys(l?.devices ?? {}).length >= 40)
  ok('pin state persisted', Array.isArray(l?.pinned) && l.pinned.includes(draggedId))
  draggedTransform = await getTransform(pinnedDev)
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
  await page.waitForTimeout(600)
  ok('single click shows the compact info card', (await page.locator('.react-flow').getByText('Uptime').count()) > 0)
  ok('single click does NOT open the sidebar', (await page.locator(drawerSel).count()) === 0)
  const dimCount = await page.locator(nodeSel).evaluateAll(ns => ns.filter(n => parseFloat(getComputedStyle(n.firstElementChild).opacity) < 0.45).length)
  ok('unrelated phones dim to ~20% while selected', dimCount > 20)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  ok('Escape clears selection and card', (await page.locator('.react-flow').getByText('Uptime').count()) === 0)
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
  // Reopen (double-click), pin, canvas click keeps it open.
  await page.locator(`.react-flow__node[data-id="${draggedId}"]`).dblclick()
  await page.locator(drawerSel).waitFor({ timeout: 15000 })
  await page.locator('button[title*="stays open"]').first().click()
  await page.waitForTimeout(300)
  await paneClick()
  await page.waitForTimeout(500)
  ok('pinned sidebar stays open on canvas click', (await page.locator(drawerSel).count()) === 1)
  await page.locator('button[title*="closes when selection"]').first().click()
  await page.waitForTimeout(200)
  await paneClick()
  await page.waitForTimeout(400)
}

// ── 7. Sidebar "Full Control" action opens phone control ─────────────────────
{
  await page.locator(`.react-flow__node[data-id="${draggedId}"]`).dblclick()
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
  ok('layout lock prevents node movement', dist(parseXY(before), parseXY(await getTransform(first))) < 14)
  await page.getByRole('button', { name: /Locked|Unlock layout/ }).first().click()
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
}

// ── 10. Reload: positions survive ────────────────────────────────────────────
{
  await page.reload({ waitUntil: 'networkidle' })
  await waitGraph()
  const moved = page.locator(`.react-flow__node[data-id="${draggedId}"]`)
  ok('node position survives reload', dist(parseXY(await getTransform(moved)), parseXY(draggedTransform)) < 40)
}

// ── 11. Team: global date-range updates KPIs + table ─────────────────────────
{
  await page.getByRole('button', { name: 'TEAM' }).click()
  await page.waitForTimeout(1800)
  ok('team shows live + period sections', await page.getByText('Currently On Shift').isVisible())
  const hoursCard = page.locator('div', { hasText: /^Hours Worked/ }).locator('.mono.text-xl').first()
  const before = await page.getByText('Today', { exact: false }).count()
  ok('default range is Today', before > 0)
  const valToday = await hoursCard.textContent()
  await page.getByRole('button', { name: 'Last 30 Days' }).click()
  await page.waitForTimeout(800)
  const val30 = await hoursCard.textContent()
  ok('switching range updates Hours Worked', valToday !== val30)
  ok('period label reflects selection', (await page.getByText('Last 30 days').count()) > 0)
  // drawer inherits the range
  await page.locator('tbody tr').first().click()
  await page.waitForTimeout(800)
  ok('employee drawer inherits the range', (await page.getByText('Last 30 days').count()) > 1)
  await page.keyboard.press('Escape')
  await page.locator('[aria-label="Close"]').first().click().catch(() => {})
  await page.waitForTimeout(400)
}

// ── 12. Account Database: shared system + working flows ─────────────────────
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
