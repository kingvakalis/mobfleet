/**
 * NARROW, GUARDED cleanup of the duplicate "Telegram" on the REAL Mainlucia device (deploy step).
 *
 * Root cause: the repo catalog carried a typo'd Telegram bundle id `ph.telegram.Telegraph` (extra "m").
 * A stale row with that id was left installed=true (2026-06-22) while the corrected on-device probe later
 * reported the REAL id `ph.telegra.Telegraph` (2026-06-23). The old put_device_apps never retired the
 * stale id, so the UI showed Telegram twice.
 *
 * This retires ONLY the stale typo row, and ONLY when the REAL Telegram row is present & installed — so
 * the device is never left with zero Telegram entries. Idempotent; matches the full-sync RPC (retire =
 * installed=false, not delete). Read-only dry-run by default; pass --apply to write.
 *
 *   node scripts/cleanup-mainlucia-telegram-dup.mjs            # dry run (no writes)
 *   node scripts/cleanup-mainlucia-telegram-dup.mjs --apply    # retire the stale row
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Client } = require('pg')
const APPLY = process.argv.includes('--apply')
const DEVICE_ID = 'c493a378-643f-4c54-8e7d-eec6fdde1dd0' // Mainlucia
const STALE = 'ph.telegram.Telegraph' // typo (extra "m") — retire this
const REAL = 'ph.telegra.Telegraph'   // real Telegram iOS id — must remain
const raw = readFileSync('server/.env', 'utf8').replace(/^﻿/, '')
let url; for (const l of raw.split(/\r?\n/)) { const m = l.match(/^\s*DATABASE_URL\s*=\s*(.+)\s*$/); if (m) { url = m[1].replace(/^["']|["']$/g, '').trim(); break } }
const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()
const row = async (b) => (await c.query(`select id, installed from public.device_apps where device_id=$1 and bundle_id=$2`, [DEVICE_ID, b])).rows[0]
try {
  const real = await row(REAL), stale = await row(STALE)
  console.log(`device ${DEVICE_ID} (Mainlucia)`)
  console.log(`  REAL  ${REAL.padEnd(24)} ${real ? `installed=${real.installed} id=${real.id}` : 'MISSING'}`)
  console.log(`  STALE ${STALE.padEnd(24)} ${stale ? `installed=${stale.installed} id=${stale.id}` : 'absent (nothing to do)'}`)
  if (!stale) { console.log('\n✓ no stale row — nothing to clean (idempotent).'); process.exit(0) }
  if (!real || real.installed !== true) {
    console.log('\n✗ ABORT: the REAL Telegram row is missing/not-installed — refusing to retire the stale row (would leave zero Telegram). Fix detection first.')
    process.exit(1)
  }
  if (stale.installed === false) { console.log('\n✓ stale row already retired (installed=false) — nothing to do.'); process.exit(0) }
  if (!APPLY) { console.log('\n[dry-run] would set installed=false on the stale row. Re-run with --apply to write.'); process.exit(0) }
  const res = await c.query(`update public.device_apps set installed=false where device_id=$1 and bundle_id=$2 and installed=true`, [DEVICE_ID, STALE])
  const after = await row(STALE), realAfter = await row(REAL)
  console.log(`\n✓ retired ${res.rowCount} stale row(s). STALE installed=${after?.installed}, REAL installed=${realAfter?.installed}`)
  console.log(realAfter?.installed === true && after?.installed === false ? '✓ Mainlucia now shows Telegram exactly once (the real id).' : '✗ unexpected post-state — verify manually.')
} finally {
  await c.end()
}
