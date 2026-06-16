import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'

/**
 * Schema Reconciliation Checkpoint 1 -- baseline proof.
 *
 * Applies ONLY server/prisma/migrations/00000000000000_baseline/migration.sql to a DISPOSABLE,
 * EMPTY PostgreSQL database, then asserts EXACT parity against the authoritative Step 0 production
 * audit (server/ops/step0-production-audit.json): tables, columns (type/nullability/default),
 * primary keys, unique + plain indexes, foreign keys with ON DELETE/ON UPDATE behavior, that every
 * table is empty, and that `_prisma_migrations` does not exist. Produces a deterministic diff
 * report and FAILS on any unexplained difference. Also guards the exact Invite FK behavior.
 *
 * Run via `npm run test:it` with TEST_BASELINE_DB_URL pointing at a DISPOSABLE database (its public
 * schema is dropped + recreated). Skips cleanly when unset. NEVER point this at production.
 */
const URL_ = process.env.TEST_BASELINE_DB_URL
const skip: false | string = URL_ ? false : 'set TEST_BASELINE_DB_URL (a disposable empty database) to run'

const auditPath = fileURLToPath(new URL('../../ops/step0-production-audit.json', import.meta.url))
const baselinePath = fileURLToPath(new URL('../../prisma/migrations/00000000000000_baseline/migration.sql', import.meta.url))

interface AuditCol { table: string; column: string; position: number; udt_name: string; data_type: string; is_nullable: string; column_default: string | null }
interface AuditCon { name: string; type: string; table: string; definition: string }
interface AuditIdx { name: string; table: string; definition: string }
interface Audit {
  tables: string[]
  columns: AuditCol[]
  constraints: AuditCon[]
  indexes: AuditIdx[]
  prisma_migrations: { exists: boolean; rows: unknown }
}

const colKey = (t: string, c: string): string => `${t}::${c}`
const conKey = (t: string, n: string): string => `${t}::${n}`

async function freshSchema(c: Client): Promise<void> {
  // Disposable DB only: wipe to a clean public schema so the baseline applies from empty.
  await c.query('DROP SCHEMA IF EXISTS public CASCADE')
  await c.query('CREATE SCHEMA public')
}

test('baseline reproduces the audited production schema EXACTLY (deterministic diff)', { skip }, async () => {
  const audit = JSON.parse(readFileSync(auditPath, 'utf8')) as Audit
  const baselineSql = readFileSync(baselinePath, 'utf8')

  const c = new Client({ connectionString: URL_! })
  await c.connect()
  try {
    await freshSchema(c)
    await c.query(baselineSql) // apply ONLY the baseline

    // ── Introspect the resulting schema with the SAME shape the audit used ──
    const liveTables = (await c.query<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1`)).rows.map((r) => r.tablename)
    const liveCols = (await c.query<{ table_name: string; ordinal_position: number; column_name: string; data_type: string; udt_name: string; is_nullable: string; column_default: string | null }>(
      `SELECT table_name, ordinal_position, column_name, data_type, udt_name, is_nullable, column_default
       FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position`)).rows
    const liveCons = (await c.query<{ tbl: string; conname: string; type: string; def: string }>(
      `SELECT conrelid::regclass::text AS tbl, conname,
        CASE contype WHEN 'p' THEN 'primary_key' WHEN 'u' THEN 'unique' WHEN 'f' THEN 'foreign_key' WHEN 'c' THEN 'check' ELSE contype::text END AS type,
        pg_get_constraintdef(oid) AS def
       FROM pg_constraint WHERE connamespace='public'::regnamespace`)).rows
    const liveIdx = (await c.query<{ tablename: string; indexname: string; indexdef: string }>(
      `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public'`)).rows
    const pmExists = (await c.query<{ t: string | null }>(`SELECT to_regclass('public._prisma_migrations')::text AS t`)).rows[0].t !== null

    const diffs: string[] = []

    // 1) Tables
    const expTables = [...audit.tables].sort()
    if (JSON.stringify(liveTables) !== JSON.stringify(expTables)) {
      diffs.push(`TABLES mismatch:\n  expected: ${expTables.join(', ')}\n  live:     ${liveTables.join(', ')}`)
    }

    // 2) Columns (type / nullability / default / position)
    const expCol = new Map(audit.columns.map((c2) => [colKey(c2.table, c2.column), c2]))
    const liveColMap = new Map(liveCols.map((r) => [colKey(r.table_name, r.column_name), r]))
    for (const [k, e] of expCol) {
      const l = liveColMap.get(k)
      if (!l) { diffs.push(`COLUMN missing in baseline: ${k}`); continue }
      if (l.udt_name !== e.udt_name || l.data_type !== e.data_type || l.is_nullable !== e.is_nullable ||
          (l.column_default ?? null) !== (e.column_default ?? null) || Number(l.ordinal_position) !== e.position) {
        diffs.push(`COLUMN ${k} differs:\n  expected: ${JSON.stringify({ position: e.position, udt: e.udt_name, type: e.data_type, nullable: e.is_nullable, default: e.column_default })}\n  live:     ${JSON.stringify({ position: Number(l.ordinal_position), udt: l.udt_name, type: l.data_type, nullable: l.is_nullable, default: l.column_default })}`)
      }
    }
    for (const k of liveColMap.keys()) if (!expCol.has(k)) diffs.push(`COLUMN unexpected (not in audit): ${k}`)

    // 3) Constraints (NOT NULL + PK + FK + any check) -- exact name, type, and definition
    const expCon = new Map(audit.constraints.map((x) => [conKey(x.table, x.name), x]))
    const liveConMap = new Map(liveCons.map((r) => [conKey(r.tbl, r.conname), r]))
    for (const [k, e] of expCon) {
      const l = liveConMap.get(k)
      if (!l) { diffs.push(`CONSTRAINT missing in baseline: ${k} (${e.type})`); continue }
      if (l.type !== e.type || l.def !== e.definition) {
        diffs.push(`CONSTRAINT ${k} differs:\n  expected: ${e.type} :: ${e.definition}\n  live:     ${l.type} :: ${l.def}`)
      }
    }
    for (const [k, l] of liveConMap) if (!expCon.has(k)) diffs.push(`CONSTRAINT unexpected (not in audit): ${k} (${l.type} :: ${l.def})`)

    // 4) Indexes (unique + plain) -- exact name, table, definition
    const expIdx = new Map(audit.indexes.map((x) => [x.name, x]))
    const liveIdxMap = new Map(liveIdx.map((r) => [r.indexname, r]))
    for (const [k, e] of expIdx) {
      const l = liveIdxMap.get(k)
      if (!l) { diffs.push(`INDEX missing in baseline: ${k}`); continue }
      if (l.tablename !== e.table || l.indexdef !== e.definition) {
        diffs.push(`INDEX ${k} differs:\n  expected: ${e.definition}\n  live:     ${l.indexdef}`)
      }
    }
    for (const k of liveIdxMap.keys()) if (!expIdx.has(k)) diffs.push(`INDEX unexpected (not in audit): ${k}`)

    // 5) Every table empty
    for (const t of liveTables) {
      const n = (await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n
      if (n !== 0) diffs.push(`TABLE ${t} is not empty (rows=${n})`)
    }

    // 6) _prisma_migrations behavior: absent after a baseline apply (matches audit; deploy/resolve
    //    creates it later -- documented, never created here).
    if (pmExists !== audit.prisma_migrations.exists) diffs.push(`_prisma_migrations existence mismatch: live=${pmExists} audit=${audit.prisma_migrations.exists}`)
    if (pmExists) diffs.push('_prisma_migrations must NOT exist after applying only the baseline (it is created by migrate deploy/resolve, not by this SQL)')

    // ── Deterministic report ──
    const report = [
      '===== Baseline vs production audit -- normalized parity report =====',
      `tables:      audit=${expTables.length} live=${liveTables.length}`,
      `columns:     audit=${audit.columns.length} live=${liveCols.length}`,
      `constraints: audit=${audit.constraints.length} live=${liveCons.length}`,
      `indexes:     audit=${audit.indexes.length} live=${liveIdx.length}`,
      `_prisma_migrations exists: live=${pmExists} audit=${audit.prisma_migrations.exists}`,
      diffs.length ? `DIFFERENCES (${diffs.length}):\n` + diffs.map((d) => '  - ' + d).join('\n') : 'DIFFERENCES: none -- exact parity',
      '==================================================================',
    ].join('\n')
    console.log(report)

    assert.equal(diffs.length, 0, `baseline does not match the audited production schema (${diffs.length} difference(s))`)
  } finally {
    await c.end()
  }
})

test('guard: Invite_invitedByUserId_fkey matches the audited behavior exactly', { skip }, async () => {
  const c = new Client({ connectionString: URL_! })
  await c.connect()
  try {
    await freshSchema(c)
    await c.query(readFileSync(baselinePath, 'utf8'))

    const fk = (await c.query<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = '"Invite"'::regclass AND contype='f' AND conname='Invite_invitedByUserId_fkey'`)).rows
    assert.equal(fk.length, 1, 'Invite_invitedByUserId_fkey exists with that exact name')
    const def = fk[0].def
    assert.match(def, /FOREIGN KEY \("invitedByUserId"\) REFERENCES "User"\(id\)/, 'references User(id)')
    assert.match(def, /ON UPDATE CASCADE/, 'ON UPDATE CASCADE')
    assert.match(def, /ON DELETE RESTRICT/, 'ON DELETE RESTRICT')

    const col = (await c.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='Invite' AND column_name='invitedByUserId'`)).rows[0]
    assert.equal(col.is_nullable, 'NO', 'Invite.invitedByUserId is NOT NULL in the baseline (Phase 3A relaxes it later)')
  } finally {
    await c.end()
  }
})
