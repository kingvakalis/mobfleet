/**
 * Rolled-back validation of supabase/migrations/20260628140000_stream_tokens.sql against the LIVE
 * database. Opens ONE transaction, applies the migration, runs structural + functional assertions on
 * SYNTHETIC users/teams/devices/agent-keys, then ALWAYS ROLLBACK — nothing is committed.
 * Run: node scripts/validate-stream-tokens-migration.mjs
 *
 * Asserts: team member mints a token; non-member + cross-team mint rejected; the relay redeems a valid
 * token (device-scoped) and rejects a wrong-device / expired token; the relay resolves a valid device
 * publisher key and rejects a bad key. Tokens are metadata only — no video ever touches Postgres.
 */
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
const require = createRequire(pathToFileURL(join(process.cwd(), 'package.json')))
const { Client } = require('pg')

function readDatabaseUrl() {
  const raw = readFileSync('server/.env', 'utf8').replace(/^﻿/, '')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+)\s*$/)
    if (m) return m[1].replace(/^["']|["']$/g, '').trim()
  }
  throw new Error('DATABASE_URL not found in server/.env')
}
const ok = (l) => console.log(`  ✓ ${l}`)
const bad = (l, d) => { console.log(`  ✗ ${l}${d ? ' — ' + d : ''}`); process.exitCode = 1 }

async function main() {
  const migration = readFileSync('supabase/migrations/20260628140000_stream_tokens.sql', 'utf8')
  const client = new Client({ connectionString: readDatabaseUrl(), ssl: { rejectUnauthorized: false }, statement_timeout: 30000 })
  await client.connect()
  console.log('connected — opening rolled-back validation transaction\n')
  try {
    await client.query('BEGIN')
    await client.query(migration)
    ok('migration applied inside the transaction (no errors)')

    // ── structural ──
    for (const [fn, args] of [['mint_stream_token', 'uuid'], ['redeem_stream_token', 'uuid, uuid'], ['resolve_stream_publisher', 'text']]) {
      const r = await client.query(
        `select p.prosecdef, has_function_privilege('authenticated', p.oid, 'EXECUTE') as a_auth,
                has_function_privilege('anon', p.oid, 'EXECUTE') as a_anon
         from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`, [fn])
      if (!r.rows[0]) { bad(`function ${fn}(${args}) missing`); continue }
      r.rows[0].prosecdef ? ok(`${fn} present + SECURITY DEFINER`) : bad(`${fn} not SECURITY DEFINER`)
    }
    const rls = await client.query(`select relrowsecurity from pg_class where oid='public.stream_tokens'::regclass`)
    rls.rows[0]?.relrowsecurity ? ok('stream_tokens has RLS enabled (no direct-access policies)') : bad('stream_tokens RLS not enabled')

    // ── seed synthetic users/team/members/devices/agent-key ──
    const mkUser = async (tag) => {
      const id = randomUUID()
      await client.query(
        `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
            created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new)
         values ('00000000-0000-0000-0000-000000000000',$1,'authenticated','authenticated',$2,'',now(),now(),now(),'','','','')`,
        [id, `stream-${tag}-${id}@validate.test`])
      return id
    }
    const ownerU = await mkUser('owner')
    const teamA = (await client.query(`insert into public.teams (name, owner_user_id) values ('zz-stream-validate (rolled back)',$1) returning id`, [ownerU])).rows[0].id
    await client.query(`insert into public.team_members (team_id, user_id, role, status, joined_at) values ($1,$2,'owner','active',now()) on conflict (team_id,user_id) do update set status='active'`, [teamA, ownerU])
    const outsiderU = await mkUser('outsider') // a real user, NOT a member of teamA
    const devA = (await client.query(`insert into public.devices (team_id, name, udid) values ($1,'StreamA',$2) returning id`, [teamA, 'udid-' + randomUUID()])).rows[0].id
    const devA2 = (await client.query(`insert into public.devices (team_id, name, udid) values ($1,'StreamA2',$2) returning id`, [teamA, 'udid-' + randomUUID()])).rows[0].id
    // a separate team B device (cross-team mint test)
    const ownerB = await mkUser('ownerB')
    const teamB = (await client.query(`insert into public.teams (name, owner_user_id) values ('zz-stream-validate-B (rolled back)',$1) returning id`, [ownerB])).rows[0].id
    const devB = (await client.query(`insert into public.devices (team_id, name, udid) values ($1,'OtherTeam',$2) returning id`, [teamB, 'udid-' + randomUUID()])).rows[0].id
    // agent key for devA (resolve_stream_publisher test)
    const agentKey = 'agentkey-' + randomUUID()
    await client.query(
      `insert into public.device_agent_keys (device_id, team_id, key_hash, created_at) values ($1, $2, encode(extensions.digest($3,'sha256'),'hex'), now())`,
      [devA, teamA, agentKey])
    ok('seeded synthetic team/members/devices/agent-key')

    const asUser = async (label, sub, sql, params, expectOk) => {
      await client.query('SAVEPOINT sp')
      try {
        await client.query('SET LOCAL role authenticated')
        await client.query(`SET LOCAL request.jwt.claims = '${JSON.stringify({ sub, role: 'authenticated' })}'`)
        await client.query(sql, params)
        if (expectOk) ok(`${label} → allowed`); else bad(`${label} → was NOT rejected`)
      } catch (e) {
        if (!expectOk) ok(`${label} → rejected (${(e.message || '').slice(0, 44)})`)
        else bad(`${label} → unexpectedly rejected`, e.message)
      } finally { await client.query('ROLLBACK TO SAVEPOINT sp') }
    }

    // ── mint ──
    await asUser('team member mints token for own device', ownerU, `select public.mint_stream_token($1)`, [devA], true)
    await asUser('non-member mints token (rejected)', outsiderU, `select public.mint_stream_token($1)`, [devA], false)
    await asUser('cross-team mint: team A owner mints team B device (rejected)', ownerU, `select public.mint_stream_token($1)`, [devB], false)

    // ── redeem + resolve (need a PERSISTENT token/key — mint directly, no savepoint) ──
    await client.query('SET LOCAL role authenticated')
    await client.query(`SET LOCAL request.jwt.claims = '${JSON.stringify({ sub: ownerU, role: 'authenticated' })}'`)
    const minted = await client.query(`select * from public.mint_stream_token($1)`, [devA])
    const token = minted.rows[0].token
    token ? ok('mint returned a token value + expiry') : bad('mint returned no token')
    await client.query('RESET ROLE')

    const tryFn = async (label, sql, params, expectOk) => {
      // Each in its own savepoint so an expected rejection doesn't abort the whole transaction.
      await client.query('SAVEPOINT sp2')
      try { const r = await client.query(sql, params); expectOk ? ok(`${label} → ${JSON.stringify(r.rows[0] ?? {}).slice(0,60)}`) : bad(`${label} → NOT rejected`) }
      catch (e) { expectOk ? bad(`${label} → unexpectedly rejected`, e.message) : ok(`${label} → rejected (${(e.message||'').slice(0,40)})`) }
      finally { await client.query('ROLLBACK TO SAVEPOINT sp2') }
    }
    await tryFn('relay redeems valid token for its device', `select * from public.redeem_stream_token($1,$2)`, [token, devA], true)
    await tryFn('redeem token for a DIFFERENT device (rejected)', `select * from public.redeem_stream_token($1,$2)`, [token, devA2], false)
    // expired token
    const expired = (await client.query(`insert into public.stream_tokens (device_id, team_id, expires_at) values ($1,$2, now() - interval '1 minute') returning token`, [devA, teamA])).rows[0].token
    await tryFn('redeem EXPIRED token (rejected)', `select * from public.redeem_stream_token($1,$2)`, [expired, devA], false)
    // resolve publisher
    await tryFn('relay resolves valid agent device-key → device', `select public.resolve_stream_publisher($1) as device_id`, [agentKey], true)
    await tryFn('resolve BAD device-key (rejected)', `select public.resolve_stream_publisher($1) as device_id`, ['not-a-real-key'], false)
  } finally {
    await client.query('ROLLBACK')
    console.log('\nROLLBACK issued — no changes persisted to the live database')
    await client.end()
  }
}
main().catch((e) => { console.error('validation error:', e.message); process.exit(1) })
