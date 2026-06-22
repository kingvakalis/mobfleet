/**
 * Rolled-back validation of supabase/migrations/20260622120000_device_apps.sql against the LIVE database.
 * One transaction: apply the migration, run STRUCTURAL + FUNCTIONAL + RLS assertions (synthetic teams/users
 * with every role + a suspended member + a cross-team user + anon), then ALWAYS ROLLBACK. Nothing commits.
 *
 * RLS is exercised by switching to the `authenticated` role and setting request.jwt.claims.sub = a user id
 * (so auth.uid() resolves to that user), exactly how Supabase evaluates policies for a logged-in user.
 *
 * Run: node scripts/validate-device-apps-migration.mjs
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
const is = (label, actual, expected) => actual === expected ? ok(`${label} (${JSON.stringify(actual)})`) : bad(label, `got ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`)

async function main() {
  const migration = readFileSync('supabase/migrations/20260622120000_device_apps.sql', 'utf8')
  const c = new Client({ connectionString: readDatabaseUrl(), ssl: { rejectUnauthorized: false }, statement_timeout: 30000 })
  await c.connect()
  console.log('connected — opening rolled-back validation transaction\n')

  // Run `fn` as a logged-in user (auth.uid() = uid via request.jwt.claims), then reset.
  const asUser = async (uid, fn) => {
    await c.query('set local role authenticated')
    await c.query(`select set_config('request.jwt.claims', json_build_object('sub',$1::text,'role','authenticated')::text, true)`, [uid])
    try { return await fn() } finally { await c.query('reset role'); await c.query(`select set_config('request.jwt.claims','',true)`) }
  }
  const asAnon = async (fn) => {
    await c.query('set local role anon'); await c.query(`select set_config('request.jwt.claims','',true)`)
    try { return await fn() } finally { await c.query('reset role') }
  }
  // Expect a statement to be REJECTED (RLS / permission / check). Isolated by a savepoint.
  const expectReject = async (label, fn) => {
    await c.query('SAVEPOINT sp')
    try { await fn(); await c.query('RELEASE SAVEPOINT sp'); bad(label + ' was NOT rejected') }
    catch { await c.query('ROLLBACK TO SAVEPOINT sp'); ok(label + ' rejected') }
  }
  const countApps = (devId) => c.query(`select count(*)::int n from public.device_apps where device_id=$1 and installed=true`, [devId]).then(r => r.rows[0].n)
  const countPrefs = (devId) => c.query(`select count(*)::int n from public.user_device_app_preferences where device_id=$1`, [devId]).then(r => r.rows[0].n)

  try {
    await c.query('BEGIN')
    await c.query(migration); ok('migration applied inside the transaction (no errors)')
    await c.query(migration); ok('migration is idempotent (second apply: no errors)')

    // ── structural: device_apps ──
    is('device_apps table exists', (await c.query(`select to_regclass('public.device_apps') t`)).rows[0].t, 'device_apps')
    is('device_apps RLS enabled', (await c.query(`select relrowsecurity r from pg_class where oid='public.device_apps'::regclass`)).rows[0].r, true)
    const daPol = (await c.query(`select polname,polcmd from pg_policy where polrelid='public.device_apps'::regclass order by polname`)).rows
    daPol.length === 1 && daPol[0].polcmd === 'r' ? ok('device_apps: exactly ONE policy and it is SELECT (no client write policy)') : bad('device_apps policy set wrong', JSON.stringify(daPol))
    const daPriv = (await c.query(`select has_table_privilege('authenticated','public.device_apps','SELECT') s, has_table_privilege('authenticated','public.device_apps','INSERT') i, has_table_privilege('authenticated','public.device_apps','UPDATE') u, has_table_privilege('authenticated','public.device_apps','DELETE') d, has_table_privilege('anon','public.device_apps','SELECT') a`)).rows[0]
    daPriv.s && !daPriv.i && !daPriv.u && !daPriv.d ? ok('device_apps: authenticated has SELECT only (no write — agent writes via RPC)') : bad('device_apps authenticated grants wrong', JSON.stringify(daPriv))
    daPriv.a ? bad('device_apps: anon unexpectedly has SELECT') : ok('device_apps: anon has NO access')
    is('device_apps in supabase_realtime publication', (await c.query(`select count(*)::int n from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='device_apps'`)).rows[0].n, 1)

    // ── structural: user_device_app_preferences ──
    is('prefs table exists', (await c.query(`select to_regclass('public.user_device_app_preferences') t`)).rows[0].t, 'user_device_app_preferences')
    is('prefs RLS enabled', (await c.query(`select relrowsecurity r from pg_class where oid='public.user_device_app_preferences'::regclass`)).rows[0].r, true)
    const upPol = (await c.query(`select polcmd from pg_policy where polrelid='public.user_device_app_preferences'::regclass`)).rows.map(r => r.polcmd).sort().join(',')
    upPol === 'a,d,r,w' ? ok('prefs: SELECT+INSERT+UPDATE+DELETE policies present') : bad('prefs policies wrong', upPol)
    const upPriv = (await c.query(`select has_table_privilege('authenticated','public.user_device_app_preferences','SELECT') s, has_table_privilege('authenticated','public.user_device_app_preferences','INSERT') i, has_table_privilege('authenticated','public.user_device_app_preferences','UPDATE') u, has_table_privilege('authenticated','public.user_device_app_preferences','DELETE') d, has_table_privilege('anon','public.user_device_app_preferences','SELECT') a`)).rows[0]
    upPriv.s && upPriv.i && upPriv.u && upPriv.d ? ok('prefs: authenticated has SELECT+INSERT+UPDATE+DELETE') : bad('prefs authenticated grants wrong', JSON.stringify(upPriv))
    upPriv.a ? bad('prefs: anon unexpectedly has access') : ok('prefs: anon has NO access')

    // ── structural: put_device_apps RPC + action CHECK ──
    const fn = (await c.query(`select p.prosecdef, pg_get_function_identity_arguments(p.oid) a from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='put_device_apps'`)).rows[0]
    fn ? ok(`put_device_apps(${fn.a})${fn.prosecdef ? ' SECURITY DEFINER' : ''}`) : bad('put_device_apps missing')
    if (fn && !fn.prosecdef) bad('put_device_apps not SECURITY DEFINER')
    const fnGrant = (await c.query(`select has_function_privilege('authenticated',(select oid from pg_proc where proname='put_device_apps'),'EXECUTE') au, has_function_privilege('anon',(select oid from pg_proc where proname='put_device_apps'),'EXECUTE') an`)).rows[0]
    fnGrant.au && fnGrant.an ? ok('put_device_apps EXECUTE granted to authenticated + anon (device-key path)') : bad('put_device_apps grants missing', JSON.stringify(fnGrant))
    const actiondef = (await c.query(`select pg_get_constraintdef(oid) d from pg_constraint where conname='agent_commands_action_check'`)).rows[0].d
    actiondef.includes("'terminate'") && actiondef.includes("'refresh_apps'") ? ok('agent_commands action CHECK includes terminate + refresh_apps') : bad('action check missing new actions')
    for (const a of ['tap','swipe','launch','screenshot','install','reboot']) if (!actiondef.includes(`'${a}'`)) bad(`action check dropped existing action '${a}' (NOT additive)`)
    ok('action CHECK is a superset of the prior actions (additive)')

    // ── functional + RLS: synthetic teams/users/devices ──
    const s = Math.random().toString(36).slice(2)
    const mkUser = async (em) => (await c.query(`insert into auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new,raw_app_meta_data,raw_user_meta_data) values (gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$1,crypt('x',gen_salt('bf')),now(),now(),now(),'','','','','{"provider":"email"}'::jsonb,'{}'::jsonb) returning id`, [em])).rows[0].id
    const uOwner = await mkUser(`da_owner_${s}@mobfleet-test.com`)
    const uAdmin = await mkUser(`da_admin_${s}@mobfleet-test.com`)
    const uOper = await mkUser(`da_oper_${s}@mobfleet-test.com`)
    const uViewer = await mkUser(`da_view_${s}@mobfleet-test.com`)
    const uSusp = await mkUser(`da_susp_${s}@mobfleet-test.com`)
    const uOther = await mkUser(`da_other_${s}@mobfleet-test.com`)
    const teamA = (await c.query(`insert into public.teams(name,owner_user_id) values('DA Team A',$1) returning id`, [uOwner])).rows[0].id
    const teamB = (await c.query(`insert into public.teams(name,owner_user_id) values('DA Team B',$1) returning id`, [uOther])).rows[0].id
    const addMember = (team, uid, role, status = 'active') => c.query(`insert into public.team_members(team_id,user_id,role,status) values($1,$2,$3::team_role,$4) on conflict do nothing`, [team, uid, role, status])
    await addMember(teamA, uOwner, 'owner'); await addMember(teamA, uAdmin, 'admin'); await addMember(teamA, uOper, 'operator'); await addMember(teamA, uViewer, 'viewer')
    await addMember(teamA, uSusp, 'viewer', 'suspended'); await addMember(teamB, uOther, 'owner')
    const devA = (await c.query(`insert into public.devices(team_id,name,udid,platform,status) values($1,'da-dev-A',$2,'ios','online') returning id`, [teamA, 'da-udid-A-' + s])).rows[0].id
    const KEY_A = 'DA_KEY_A_' + s
    await c.query(`insert into public.device_agent_keys(device_id,team_id,key_hash) values($1,$2,encode(extensions.digest($3,'sha256'),'hex'))`, [devA, teamA, KEY_A])

    // agent uploads inventory via device-key RPC: Instagram + Settings installed; Facebook NOT installed
    const apps = JSON.stringify([
      { bundle_id: 'com.burbn.instagram', name: 'Instagram', abbr: 'In', icon_color: '#833ab4', installed: true, source: 'detected' },
      { bundle_id: 'com.apple.Preferences', name: 'Settings', abbr: 'Se', icon_color: '#636366', installed: true, source: 'system' },
      { bundle_id: 'com.facebook.Facebook', name: 'Facebook', abbr: 'Fb', icon_color: '#1877f2', installed: false, source: 'detected' },
    ])
    await c.query(`select public.put_device_apps($1,$2::jsonb)`, [KEY_A, apps]); ok('put_device_apps (device-key) upserted inventory')
    is('device_apps rows total = 3 (incl not-installed)', (await c.query(`select count(*)::int n from public.device_apps where device_id=$1`, [devA])).rows[0].n, 3)
    is('installed=true apps = 2 (Facebook installed:false NOT counted — truthful)', await countApps(devA), 2)
    // upsert idempotency: flip Facebook to installed → still 3 rows, now 3 installed
    await c.query(`select public.put_device_apps($1,$2::jsonb)`, [KEY_A, JSON.stringify([{ bundle_id: 'com.facebook.Facebook', name: 'Facebook', abbr: 'Fb', icon_color: '#1877f2', installed: true, source: 'detected' }])])
    is('put_device_apps upsert (no dup rows; unique device+bundle)', (await c.query(`select count(*)::int n from public.device_apps where device_id=$1`, [devA])).rows[0].n, 3)
    // device-key writes ONLY its own team/device (RPC derives team from key — no cross-team write)
    is('inventory written to teamA (key-derived team, not forgeable)', (await c.query(`select count(*)::int n from public.device_apps where device_id=$1 and team_id=$2`, [devA, teamA])).rows[0].n, 3)
    await expectReject('put_device_apps with INVALID device key', () => c.query(`select public.put_device_apps($1,$2::jsonb)`, ['WRONG_KEY', apps]))

    // RLS read: every ACTIVE role of teamA can read the inventory
    for (const [role, uid] of [['owner', uOwner], ['admin', uAdmin], ['operator', uOper], ['viewer', uViewer]]) {
      const n = await asUser(uid, () => countApps(devA))
      is(`RLS: ${role} reads teamA inventory (installed apps)`, n, 3)
    }
    // suspended member blocked
    is('RLS: SUSPENDED member cannot read inventory', await asUser(uSusp, () => countApps(devA)), 0)
    // cross-team blocked
    is('RLS: cross-team user (teamB owner) cannot read teamA inventory', await asUser(uOther, () => countApps(devA)), 0)
    // anon blocked (no grant → error)
    await expectReject('anon SELECT device_apps (no grant)', () => asAnon(() => c.query(`select * from public.device_apps where device_id=$1`, [devA])))

    // prefs: a user manages ONLY their own, only for a team they belong to
    await asUser(uViewer, () => c.query(`insert into public.user_device_app_preferences(user_id,team_id,device_id,bundle_id,visible) values($1,$2,$3,'com.burbn.instagram',false)`, [uViewer, teamA, devA]))
    ok('viewer upserted their own visibility pref (hide Instagram)')
    is('viewer reads their own pref', await asUser(uViewer, async () => (await c.query(`select count(*)::int n from public.user_device_app_preferences where device_id=$1 and visible=false`, [devA])).rows[0].n), 1)
    is('operator does NOT see the viewer\'s pref (own-row isolation)', await asUser(uOper, () => countPrefs(devA)), 0)
    // forged team_id (device belongs to teamA, claim teamB) → insert WITH CHECK rejects
    await expectReject('pref insert with FORGED team_id (device not in that team)', () => asUser(uViewer, () => c.query(`insert into public.user_device_app_preferences(user_id,team_id,device_id,bundle_id,visible) values($1,$2,$3,'com.apple.Preferences',false)`, [uViewer, teamB, devA])))
    // pref for someone else's user_id → rejected (user_id must = auth.uid())
    await expectReject('pref insert with another user_id', () => asUser(uViewer, () => c.query(`insert into public.user_device_app_preferences(user_id,team_id,device_id,bundle_id,visible) values($1,$2,$3,'com.apple.Preferences',false)`, [uOper, teamA, devA])))
    // cross-team user cannot insert a pref for teamA's device
    await expectReject('cross-team pref insert (teamB user, teamA device)', () => asUser(uOther, () => c.query(`insert into public.user_device_app_preferences(user_id,team_id,device_id,bundle_id,visible) values($1,$2,$3,'com.burbn.instagram',false)`, [uOther, teamA, devA])))
    // suspended member cannot write a pref
    await expectReject('suspended member pref insert', () => asUser(uSusp, () => c.query(`insert into public.user_device_app_preferences(user_id,team_id,device_id,bundle_id,visible) values($1,$2,$3,'com.burbn.instagram',false)`, [uSusp, teamA, devA])))

    // cascade: deleting the device removes its inventory + prefs
    await c.query(`delete from public.devices where id=$1`, [devA])
    is('device delete CASCADES device_apps', (await c.query(`select count(*)::int n from public.device_apps where device_id=$1`, [devA])).rows[0].n, 0)
    is('device delete CASCADES prefs', await countPrefs(devA), 0)
  } finally {
    await c.query('ROLLBACK')
    console.log('\nROLLBACK issued — no changes persisted to the live database')
    await c.end()
  }
  console.log(`\n==== DEVICE_APPS MIGRATION + RLS: ${pass} passed, ${fail} failed ${fail ? '❌' : '✅'} ====`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error('validation error:', e.message); process.exit(1) })
