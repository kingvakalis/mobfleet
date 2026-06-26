/**
 * Rolled-back validation of supabase/migrations/20260627120000_device_rename_permission.sql
 * against the LIVE database. Opens ONE transaction, applies the migration, runs structural +
 * functional RBAC assertions on SYNTHETIC users/teams/devices, then ALWAYS ROLLBACK. Nothing is
 * ever committed — the live schema/data are untouched. Run: node scripts/validate-device-rename-migration.mjs
 *
 * Functional tests simulate each member by setting the request.jwt.claims `sub` (what auth.uid()
 * reads) inside a SAVEPOINT, attempting the rename, then rolling the savepoint back (which also
 * reverts the SET LOCAL role/claims). Asserts: owner/admin allowed; operator/viewer denied unless
 * granted phones.rename; explicit deny beats owner; cross-team blocked; empty/too-long rejected;
 * a non-name update still works for an operator; direct devices.update name is blocked too.
 */
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
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
  const migration = readFileSync('supabase/migrations/20260627120000_device_rename_permission.sql', 'utf8')
  const client = new Client({ connectionString: readDatabaseUrl(), ssl: { rejectUnauthorized: false }, statement_timeout: 30000 })
  await client.connect()
  console.log('connected — opening rolled-back validation transaction\n')
  try {
    await client.query('BEGIN')
    await client.query(migration)
    ok('migration applied inside the transaction (no errors)')

    // ── structural ──────────────────────────────────────────────────────────
    for (const [fn, args] of [['can_rename_device', 'uuid'], ['rename_device', 'uuid, text']]) {
      const r = await client.query(
        `select p.prosecdef, has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
         from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname=$1`, [fn])
      if (!r.rows[0]) { fail(`function ${fn}(${args}) missing`); continue }
      ok(`function ${fn}(${args}) present`)
      r.rows[0].prosecdef ? ok(`${fn} is SECURITY DEFINER`) : fail(`${fn} not SECURITY DEFINER`)
      r.rows[0].auth ? ok(`authenticated may EXECUTE ${fn}`) : fail(`${fn} not executable by authenticated`)
    }
    const trg = await client.query(
      `select tgname from pg_trigger where tgrelid='public.devices'::regclass and tgname='trg_enforce_device_rename'`)
    trg.rows[0] ? ok('BEFORE UPDATE trigger trg_enforce_device_rename present on devices') : fail('rename trigger missing')

    // ── seed synthetic users/teams/members/devices (rolled back) ──────────────
    const mkUser = async (email) => {
      const id = randomUUID()
      await client.query(
        `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
            created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new)
         values ('00000000-0000-0000-0000-000000000000',$1,'authenticated','authenticated',$2,'',now(),now(),now(),'','','','')`,
        [id, `${email}-${id}@validate.test`])
      return id
    }
    const addMember = async (teamId, userId, role, overrides) =>
      client.query(
        `insert into public.team_members (team_id, user_id, role, status, overrides, joined_at)
         values ($1,$2,$3,'active',$4::jsonb, now())
         on conflict (team_id, user_id) do update set role=excluded.role, status='active', overrides=excluded.overrides`,
        [teamId, userId, role, JSON.stringify(overrides ?? {})])

    const ownerU = await mkUser('owner')
    const teamA = (await client.query(`insert into public.teams (name, owner_user_id) values ('zz-rename-validate (rolled back)',$1) returning id`, [ownerU])).rows[0].id
    // handle_new_team already created the owner member; ensure status/overrides set:
    await addMember(teamA, ownerU, 'owner', {})
    const adminU = await mkUser('admin');           await addMember(teamA, adminU, 'admin', {})
    const opU = await mkUser('op');                 await addMember(teamA, opU, 'operator', {})
    const opGrantU = await mkUser('op-grant');      await addMember(teamA, opGrantU, 'operator', { 'phones.rename': 'allow' })
    const viewerU = await mkUser('viewer');         await addMember(teamA, viewerU, 'viewer', {})
    const viewerGrantU = await mkUser('viewer-grant'); await addMember(teamA, viewerGrantU, 'viewer', { 'phones.rename': 'allow' })
    const ownerDenyU = await mkUser('owner-deny');  await addMember(teamA, ownerDenyU, 'owner', { 'phones.rename': 'deny' })
    const deviceA = (await client.query(`insert into public.devices (team_id, name, udid) values ($1,'Mainlucia',$2) returning id`, [teamA, 'udid-' + randomUUID()])).rows[0].id

    // a separate team B (cross-team test)
    const ownerB = await mkUser('ownerB')
    const teamB = (await client.query(`insert into public.teams (name, owner_user_id) values ('zz-rename-validate-B (rolled back)',$1) returning id`, [ownerB])).rows[0].id
    const deviceB = (await client.query(`insert into public.devices (team_id, name, udid) values ($1,'OtherTeamPhone',$2) returning id`, [teamB, 'udid-' + randomUUID()])).rows[0].id

    ok('seeded synthetic team/members/devices')

    // ── functional: run `sql` AS `sub`, expecting success or rejection ────────
    const asUser = async (label, sub, sql, params, expectOk) => {
      await client.query('SAVEPOINT sp')
      try {
        await client.query('SET LOCAL role authenticated')
        await client.query(`SET LOCAL request.jwt.claims = '${JSON.stringify({ sub, role: 'authenticated' })}'`)
        await client.query(sql, params)
        // reached here = succeeded
        if (expectOk) ok(`${label} → allowed`); else fail(`${label} → was NOT rejected`)
      } catch (e) {
        if (!expectOk) ok(`${label} → rejected (${(e.message || '').slice(0, 48)})`)
        else fail(`${label} → unexpectedly rejected`, e.message)
      } finally {
        await client.query('ROLLBACK TO SAVEPOINT sp')
      }
    }
    const RPC = `select public.rename_device($1,$2)`

    // RPC path
    await asUser('owner rename (RPC)', ownerU, RPC, [deviceA, 'Renamed-Owner'], true)
    await asUser('admin rename (RPC)', adminU, RPC, [deviceA, 'Renamed-Admin'], true)
    await asUser('operator rename, NO grant (RPC)', opU, RPC, [deviceA, 'Nope'], false)
    await asUser('operator rename, granted phones.rename (RPC)', opGrantU, RPC, [deviceA, 'Renamed-Op'], true)
    await asUser('viewer rename, NO grant (RPC)', viewerU, RPC, [deviceA, 'Nope'], false)
    await asUser('viewer rename, granted phones.rename (RPC)', viewerGrantU, RPC, [deviceA, 'Renamed-Viewer'], true)
    await asUser('owner with explicit deny override (RPC)', ownerDenyU, RPC, [deviceA, 'Nope'], false)
    await asUser('cross-team rename: team A owner renames team B device (RPC)', ownerU, RPC, [deviceB, 'Hijack'], false)
    await asUser('empty name rejected (RPC)', ownerU, RPC, [deviceA, '   '], false)
    await asUser('too-long name (>64) rejected (RPC)', ownerU, RPC, [deviceA, 'x'.repeat(65)], false)

    // direct devices.update path — trigger must enforce the same rule
    const UPD = `update public.devices set name=$2 where id=$1`
    await asUser('owner rename (direct update)', ownerU, UPD, [deviceA, 'Direct-Owner'], true)
    await asUser('operator rename, NO grant (direct update) blocked by trigger', opU, UPD, [deviceA, 'Sneak'], false)
    // an operator may still update a NON-name field (can_write_team) — trigger only guards name
    await asUser('operator NON-name update (status) still allowed', opU, `update public.devices set status='online' where id=$1`, [deviceA], true)

    // service / agent path (auth.uid() IS NULL, e.g. claim_device re-pair): name validation is
    // skipped so a long agent-supplied name does NOT retroactively break provisioning.
    await client.query('SAVEPOINT sp_service')
    try {
      await client.query(`update public.devices set name=$2 where id=$1`, [deviceA, 'x'.repeat(80)])
      ok('service-role (auth.uid NULL) long name change allowed (claim_device re-pair not blocked)')
    } catch (e) {
      fail('service-role long-name update unexpectedly rejected', e.message)
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT sp_service')
    }
  } finally {
    await client.query('ROLLBACK')
    console.log('\nROLLBACK issued — no changes persisted to the live database')
    await client.end()
  }
}

main().catch((e) => { console.error('validation error:', e.message); process.exit(1) })
