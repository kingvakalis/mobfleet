/**
 * Rolled-back validation of supabase/migrations/20260621120000_device_viewers.sql against
 * the LIVE database. One transaction: apply the migration, run structural + functional
 * assertions (synthetic rows under a real team), then ALWAYS ROLLBACK. Nothing is committed.
 * Run: node scripts/validate-device-viewers-migration.mjs
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

let pass = 0, fail = 0
const ok = (l) => { pass++; console.log(`  ✓ ${l}`) }
const bad = (l, d = '') => { fail++; console.log(`  ✗ ${l}${d ? ' — ' + d : ''}`) }

async function main() {
  const migration = readFileSync('supabase/migrations/20260621120000_device_viewers.sql', 'utf8')
  const c = new Client({ connectionString: readDatabaseUrl(), ssl: { rejectUnauthorized: false }, statement_timeout: 30000 })
  await c.connect()
  console.log('connected — opening rolled-back validation transaction\n')
  const expectThrow = async (label, sql, params) => {
    await c.query('SAVEPOINT sp')
    try { await c.query(sql, params); await c.query('RELEASE SAVEPOINT sp'); bad(label + ' was NOT rejected') }
    catch { await c.query('ROLLBACK TO SAVEPOINT sp'); ok(label + ' rejected') }
  }
  // Switch to the authenticated role for a member, run fn, then RESET ROLE (not rollback)
  // so any successful DML (e.g. mark_device_viewer) PERSISTS within the outer transaction.
  const asMember = async (uid, fn) => {
    await c.query('set local role authenticated')
    await c.query(`select set_config('request.jwt.claims', json_build_object('sub',$1::text,'role','authenticated')::text, true)`, [uid])
    try { return await fn() }
    finally { await c.query('reset role'); await c.query(`select set_config('request.jwt.claims', '', true)`) }
  }
  try {
    await c.query('BEGIN')
    await c.query(migration); ok('migration applied inside the transaction (no errors)')

    // structural
    ok(`table exists: ${(await c.query(`select to_regclass('public.device_viewers') t`)).rows[0].t ?? bad('table missing')}`)
    ;(await c.query(`select relrowsecurity r from pg_class where oid='public.device_viewers'::regclass`)).rows[0].r ? ok('RLS enabled') : bad('RLS off')
    const pol = (await c.query(`select polname,polcmd from pg_policy where polrelid='public.device_viewers'::regclass`)).rows
    pol.length === 1 && pol[0].polcmd === 'r' ? ok('exactly one SELECT policy (no client write policy)') : bad('policy set wrong', JSON.stringify(pol))
    for (const [fn, args] of [['mark_device_viewer', 'uuid, integer'], ['device_viewer_fps', 'text, integer']]) {
      const r = (await c.query(`select p.prosecdef, pg_get_function_identity_arguments(p.oid) a from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`, [fn])).rows[0]
      r ? ok(`function ${fn}(${r.a})${r.prosecdef ? ' SECURITY DEFINER' : ''}`) : bad(`function ${fn} missing`)
      if (r && !r.prosecdef) bad(`${fn} not SECURITY DEFINER`)
    }
    const pv = (await c.query(`select has_table_privilege('authenticated','public.device_viewers','SELECT') s, has_table_privilege('authenticated','public.device_viewers','INSERT') i, has_table_privilege('anon','public.device_viewers','SELECT') a`)).rows[0]
    pv.s ? ok('authenticated has SELECT') : bad('authenticated missing SELECT')
    pv.i ? bad('authenticated unexpectedly has INSERT (writes must be RPC-only)') : ok('authenticated has NO direct INSERT (RPC-only)')
    pv.a ? bad('anon unexpectedly has SELECT') : ok('anon has NO SELECT')
    const g = (await c.query(`select has_function_privilege('authenticated', (select oid from pg_proc where proname='mark_device_viewer'), 'EXECUTE') mk_auth,
                                     has_function_privilege('anon', (select oid from pg_proc where proname='device_viewer_fps'), 'EXECUTE') fps_anon,
                                     has_function_privilege('authenticated', (select oid from pg_proc where proname='device_viewer_fps'), 'EXECUTE') fps_auth`)).rows[0]
    g.mk_auth ? ok('mark_device_viewer EXECUTE granted to authenticated') : bad('mark grant missing')
    g.fps_anon && g.fps_auth ? ok('device_viewer_fps EXECUTE granted to anon + authenticated (device-key path)') : bad('fps grants missing')

    // functional — synthetic team/device/key/member, rolled back
    const team = (await c.query(`select id from public.teams limit 1`)).rows[0]
    if (!team) { console.log('  ⚠ no teams — skipping functional checks'); }
    else {
      const teamId = team.id
      const s = Math.random().toString(36).slice(2)
      const mkUser = async (em) => (await c.query(`insert into auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new,raw_app_meta_data,raw_user_meta_data) values (gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$1,crypt('x',gen_salt('bf')),now(),now(),now(),'','','','','{"provider":"email"}'::jsonb,'{}'::jsonb) returning id`, [em])).rows[0].id
      const uidMember = await mkUser(`vw_m_${s}@mobfleet-test.com`)
      const uidOther = await mkUser(`vw_o_${s}@mobfleet-test.com`)
      await c.query(`insert into public.team_members(team_id,user_id,role) values($1,$2,'operator') on conflict do nothing`, [teamId, uidMember])
      const teamB = (await c.query(`insert into public.teams(name,owner_user_id) values('VW Other',$1) returning id`, [uidOther])).rows[0].id
      await c.query(`insert into public.team_members(team_id,user_id,role) values($1,$2,'owner') on conflict do nothing`, [teamB, uidOther])
      const devId = (await c.query(`insert into public.devices(team_id,name,udid,platform,status) values($1,'vw-dev',$2,'ios','online') returning id`, [teamId, 'vw-udid-' + s])).rows[0].id
      const KEY = 'VW_KEY_' + s
      await c.query(`insert into public.device_agent_keys(device_id,team_id,key_hash) values($1,$2,encode(extensions.digest($3,'sha256'),'hex'))`, [devId, teamId, KEY])

      // no viewer row yet → fps 0
      ;(await c.query(`select public.device_viewer_fps($1) f`, [KEY])).rows[0].f === 0 ? ok('device_viewer_fps = 0 when no viewer present') : bad('expected 0 with no viewer')
      // member marks viewer @ 4 fps
      await asMember(uidMember, () => c.query(`select public.mark_device_viewer($1, 4)`, [devId]))
      ;(await c.query(`select public.device_viewer_fps($1) f`, [KEY])).rows[0].f === 4 ? ok('agent sees fps=4 after a member marks viewer') : bad('fps not 4 after mark')
      // clamp
      await asMember(uidMember, () => c.query(`select public.mark_device_viewer($1, 999)`, [devId]))
      ;(await c.query(`select public.device_viewer_fps($1) f`, [KEY])).rows[0].f === 15 ? ok('requested fps clamped to 15') : bad('fps not clamped')
      // staleness → 0
      await c.query(`update public.device_viewers set last_seen_at = now() - interval '1 minute' where device_id=$1`, [devId])
      ;(await c.query(`select public.device_viewer_fps($1, 12) f`, [KEY])).rows[0].f === 0 ? ok('stale viewer (>window) → fps 0') : bad('stale viewer not 0')
      // member READ via RLS
      const rd = await asMember(uidMember, async () => (await c.query(`select count(*)::int n from public.device_viewers where device_id=$1`, [devId])).rows[0].n)
      rd === 1 ? ok('member reads their team viewer row (RLS)') : bad('member read failed', `n=${rd}`)
      // non-member (team B) blocked from read + mark
      const rdB = await asMember(uidOther, async () => (await c.query(`select count(*)::int n from public.device_viewers where device_id=$1`, [devId])).rows[0].n)
      rdB === 0 ? ok('non-member blocked from reading the viewer row (cross-team)') : bad('cross-team read leak', `n=${rdB}`)
      await c.query('SAVEPOINT nm'); await c.query('set local role authenticated')
      await c.query(`select set_config('request.jwt.claims', json_build_object('sub',$1::text,'role','authenticated')::text, true)`, [uidOther])
      try { await c.query(`select public.mark_device_viewer($1, 4)`, [devId]); await c.query('RELEASE SAVEPOINT nm'); bad('non-member mark was NOT rejected') }
      catch { await c.query('ROLLBACK TO SAVEPOINT nm'); ok('non-member mark_device_viewer rejected') }
      // invalid device key
      await expectThrow('invalid device key (device_viewer_fps)', `select public.device_viewer_fps($1)`, ['WRONG_KEY'])
      // cascade
      await c.query(`delete from public.devices where id=$1`, [devId])
      ;(await c.query(`select count(*)::int n from public.device_viewers where device_id=$1`, [devId])).rows[0].n === 0 ? ok('device delete CASCADES the viewer row') : bad('cascade did not remove viewer row')
    }
  } finally {
    await c.query('ROLLBACK')
    console.log('\nROLLBACK issued — no changes persisted to the live database')
    await c.end()
  }
  console.log(`\n==== DEVICE_VIEWERS: ${pass} passed, ${fail} failed ${fail ? '❌' : '✅'} ====`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error('validation error:', e.message); process.exit(1) })
