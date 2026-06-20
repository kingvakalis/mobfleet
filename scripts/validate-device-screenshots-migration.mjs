/**
 * Rolled-back validation of supabase/migrations/20260620140000_device_screenshots.sql
 * against the LIVE database. Opens ONE transaction, applies the migration, runs
 * structural + functional assertions (seeding ONLY synthetic rows under an existing
 * team), then ALWAYS ROLLBACK. Nothing is ever committed — the live schema/data are
 * untouched. Run: node scripts/validate-device-screenshots-migration.mjs
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Client } = require('pg')

function readDatabaseUrl() {
  const raw = readFileSync('server/.env', 'utf8').replace(/^﻿/, '')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+)\s*$/)
    if (m) return m[1].replace(/^["']|["']$/g, '').trim()
  }
  throw new Error('DATABASE_URL not found in server/.env')
}

const ok = (label) => console.log(`  ✓ ${label}`)
const fail = (label, detail) => { console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); process.exitCode = 1 }

async function main() {
  const migration = readFileSync('supabase/migrations/20260620140000_device_screenshots.sql', 'utf8')
  const client = new Client({ connectionString: readDatabaseUrl(), ssl: { rejectUnauthorized: false }, statement_timeout: 30000 })
  await client.connect()
  console.log('connected — opening rolled-back validation transaction\n')
  try {
    await client.query('BEGIN')

    // 1) migration applies cleanly
    await client.query(migration)
    ok('migration applied inside the transaction (no errors)')

    // 2) structural assertions
    const reg = await client.query(`select to_regclass('public.device_screenshots') as t`)
    reg.rows[0].t ? ok('table public.device_screenshots exists') : fail('table missing')

    const rls = await client.query(`select relrowsecurity from pg_class where oid = 'public.device_screenshots'::regclass`)
    rls.rows[0]?.relrowsecurity ? ok('row level security enabled') : fail('RLS not enabled')

    const pol = await client.query(`select polname, polcmd from pg_policy where polrelid = 'public.device_screenshots'::regclass`)
    const selPol = pol.rows.find(p => p.polname === 'device_screenshots_select' && p.polcmd === 'r')
    selPol ? ok('SELECT policy device_screenshots_select present') : fail('select policy missing', JSON.stringify(pol.rows))
    pol.rows.length === 1 ? ok('exactly one policy (no insert/update/delete to clients)') : fail('unexpected extra policies', JSON.stringify(pol.rows))

    const fn = await client.query(`select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef
                                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                   where n.nspname='public' and p.proname='put_device_screenshot'`)
    if (!fn.rows[0]) fail('function put_device_screenshot missing')
    else {
      ok(`function put_device_screenshot(${fn.rows[0].args})`)
      fn.rows[0].prosecdef ? ok('function is SECURITY DEFINER') : fail('function not SECURITY DEFINER')
    }

    const tablePriv = await client.query(`select has_table_privilege('authenticated','public.device_screenshots','SELECT') as s,
                                                  has_table_privilege('authenticated','public.device_screenshots','INSERT') as i`)
    tablePriv.rows[0].s ? ok('authenticated has SELECT') : fail('authenticated missing SELECT')
    tablePriv.rows[0].i ? fail('authenticated unexpectedly has INSERT (writes must be RPC-only)') : ok('authenticated has NO direct INSERT (RPC-only writes)')

    const fnPriv = await client.query(`select has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
                                              has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
                                       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                                       where n.nspname='public' and p.proname='put_device_screenshot'`)
    fnPriv.rows[0].anon && fnPriv.rows[0].auth ? ok('anon + authenticated can EXECUTE the RPC (device-key path)') : fail('RPC execute grants missing')

    // 3) functional assertions — seed SYNTHETIC rows under a real team, all rolled back
    const team = await client.query(`select id from public.teams limit 1`)
    if (!team.rows[0]) {
      console.log('  ⚠ no teams in DB — skipping functional RPC test (structural checks above stand)')
    } else {
      const teamId = team.rows[0].id
      const KEY = 'VALIDATE_TESTKEY_rollback_only'
      const dev = await client.query(
        `insert into public.devices (team_id, name, udid, platform, status) values ($1,$2,$3,'ios','offline') returning id`,
        [teamId, 'zz-migration-validate (rolled back)', 'validate-udid-' + Math.random().toString(36).slice(2)],
      )
      const deviceId = dev.rows[0].id
      await client.query(
        `insert into public.device_agent_keys (device_id, team_id, key_hash)
         values ($1,$2, encode(extensions.digest($3,'sha256'),'hex'))`,
        [deviceId, teamId, KEY],
      )

      // a) basic upload + read back
      await client.query(`select public.put_device_screenshot($1, null, $2, 'png', 390, 844)`, [KEY, 'AAAAbase64'])
      const row = await client.query(`select image_base64, format, width, height, command_id from public.device_screenshots where device_id=$1`, [deviceId])
      if (row.rows[0]?.image_base64 === 'AAAAbase64' && row.rows[0].width === 390 && row.rows[0].height === 844) ok('RPC inserts the frame (bytes + logical dims) readable via the row')
      else fail('RPC did not store the frame correctly', JSON.stringify(row.rows[0]))

      // b) upsert (one row per device) — second call replaces, never duplicates
      await client.query(`select public.put_device_screenshot($1, null, $2, 'png', 100, 200)`, [KEY, 'BBBBbase64'])
      const cnt = await client.query(`select count(*)::int n, max(image_base64) b from public.device_screenshots where device_id=$1`, [deviceId])
      cnt.rows[0].n === 1 && cnt.rows[0].b === 'BBBBbase64' ? ok('upsert keeps exactly one row per device (latest frame)') : fail('upsert produced wrong state', JSON.stringify(cnt.rows[0]))

      // c) command_id provenance — own command kept, foreign command nulled
      const cmd = await client.query(
        `insert into public.agent_commands (team_id, device_id, action) values ($1,$2,'screenshot') returning id`, [teamId, deviceId])
      const myCmd = cmd.rows[0].id
      await client.query(`select public.put_device_screenshot($1, $2, 'CCCC', 'png', 1, 1)`, [KEY, myCmd])
      const prov = await client.query(`select command_id from public.device_screenshots where device_id=$1`, [deviceId])
      prov.rows[0].command_id === myCmd ? ok('own command_id stored as provenance') : fail('own command_id not stored', JSON.stringify(prov.rows[0]))

      const dev2 = await client.query(`insert into public.devices (team_id, name, udid) values ($1,'zz-other (rolled back)',$2) returning id`,
        [teamId, 'validate-udid2-' + Math.random().toString(36).slice(2)])
      const cmd2 = await client.query(`insert into public.agent_commands (team_id, device_id, action) values ($1,$2,'home') returning id`, [teamId, dev2.rows[0].id])
      await client.query(`select public.put_device_screenshot($1, $2, 'DDDD', 'png', 1, 1)`, [KEY, cmd2.rows[0].id])
      const prov2 = await client.query(`select command_id from public.device_screenshots where device_id=$1`, [deviceId])
      prov2.rows[0].command_id === null ? ok('foreign-device command_id rejected → stored null (no cross-device attribution)') : fail('foreign command_id not nulled', JSON.stringify(prov2.rows[0]))

      // expectThrow runs inside a SAVEPOINT so an intentional RPC exception doesn't
      // poison the outer transaction (a failed statement aborts the whole tx otherwise).
      const expectThrow = async (label, sql, params) => {
        await client.query('SAVEPOINT sp')
        try { await client.query(sql, params); await client.query('RELEASE SAVEPOINT sp'); fail(label + ' was NOT rejected') }
        catch { await client.query('ROLLBACK TO SAVEPOINT sp'); ok(label + ' rejected') }
      }

      // d) invalid key rejected
      await expectThrow('invalid device key', `select public.put_device_screenshot($1, null, 'X', 'png', 1, 1)`, ['WRONG_KEY'])
      // e) empty payload rejected
      await expectThrow('empty screenshot payload', `select public.put_device_screenshot($1, null, '', 'png', 1, 1)`, [KEY])

      // g) format allow-list: RPC coerces an unknown MIME to png; the column CHECK backstops
      await client.query(`select public.put_device_screenshot($1, null, 'EEEE', 'svg', 1, 1)`, [KEY])
      const fmt = await client.query(`select format from public.device_screenshots where device_id=$1`, [deviceId])
      fmt.rows[0].format === 'png' ? ok('unknown format coerced to png by the RPC (no arbitrary MIME persisted)') : fail('format not coerced', JSON.stringify(fmt.rows[0]))
      await expectThrow('column CHECK rejects a non-allowlisted format', `update public.device_screenshots set format='svg' where device_id=$1`, [deviceId])

      // f) device delete cascades the frame
      await client.query(`delete from public.devices where id=$1`, [deviceId])
      const afterDel = await client.query(`select count(*)::int n from public.device_screenshots where device_id=$1`, [deviceId])
      afterDel.rows[0].n === 0 ? ok('device delete CASCADES the screenshot row') : fail('cascade did not remove the frame')
    }
  } finally {
    await client.query('ROLLBACK')
    console.log('\nROLLBACK issued — no changes persisted to the live database')
    await client.end()
  }
}

main().catch((e) => { console.error('validation error:', e.message); process.exit(1) })
