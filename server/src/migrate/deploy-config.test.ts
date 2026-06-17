import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Pure guard (no DB) for the Checkpoint 3 deploy mechanism: application startup is SERVER-ONLY,
// schema mutation is removed from startup, the dedicated pre-deploy migration command fails closed,
// and no automatic baseline-resolve exists in the deploy path.

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const pkg = JSON.parse(read('../../package.json')) as { scripts: Record<string, string> }
const dockerfile = read('../../Dockerfile')
const railway = read('../../../railway.toml')
const migrateRunner = read('../../scripts/migrate-deploy.mjs')

test('package.json: startup is server-only and never mutates the schema', () => {
  assert.equal(pkg.scripts['start:prod'], 'node dist/index.js')
  // No script applies the schema via db push, and none uses the data-loss flag.
  for (const [name, cmd] of Object.entries(pkg.scripts)) {
    assert.ok(!/prisma\s+db\s+push/.test(cmd), `script ${name} must not run prisma db push`)
    assert.ok(!cmd.includes('--accept-data-loss'), `script ${name} must not use --accept-data-loss`)
  }
  assert.ok(!('db:push:prod' in pkg.scripts), 'the db:push:prod escape hatch is removed')
})

test('package.json: dedicated migrate:deploy command exists', () => {
  assert.equal(pkg.scripts['migrate:deploy'], 'node scripts/migrate-deploy.mjs')
})

// executable JS (strip `//` comment lines) so the doc comments don't trip the negative scans
const migrateCode = migrateRunner.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
// non-comment toml lines (strip `#` comment lines)
const railwayCode = railway.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')

test('migrate-deploy.mjs: fails closed, dedicated URL, no db push / resolve / data-loss / runtime fallback', () => {
  assert.ok(migrateRunner.includes('MIGRATION_DATABASE_URL'), 'uses MIGRATION_DATABASE_URL')
  assert.ok(migrateCode.includes('migrate') && migrateCode.includes('deploy'), 'runs migrate deploy')
  assert.ok(migrateCode.includes('schema.postgres.prisma'), 'uses the postgres schema')
  // Fail closed: it must exit non-zero when MIGRATION_DATABASE_URL is missing.
  assert.ok(/MIGRATION_DATABASE_URL[\s\S]*process\.exit\(1\)/.test(migrateCode), 'exits 1 when MIGRATION_DATABASE_URL is absent')
  // No forbidden behaviors (executable code only).
  assert.ok(!/db\s+push/.test(migrateCode), 'no db push')
  assert.ok(!migrateCode.includes('--accept-data-loss'), 'no --accept-data-loss')
  assert.ok(!/resolve/.test(migrateCode), 'no automatic migrate resolve')
  // It must NOT fall back to the runtime writer URL.
  assert.ok(!/DATABASE_URL\s*\|\|/.test(migrateCode) && !/\?\?\s*process\.env\.DATABASE_URL/.test(migrateCode), 'no fallback to DATABASE_URL')
})

test('railway.toml: server-only startCommand + once-per-release pre-deploy migrate (no auto resolve)', () => {
  assert.match(railwayCode, /startCommand\s*=\s*"node dist\/index\.js"/, 'startCommand is server-only')
  assert.match(railwayCode, /preDeployCommand\s*=\s*"npm run migrate:deploy"/, 'preDeployCommand runs the dedicated migrate command')
  assert.ok(!/prisma\s+db\s+push/.test(railwayCode), 'no db push in railway config')
  assert.ok(!/migrate\s+resolve/.test(railwayCode), 'no automatic baseline resolve in the deploy path')
})

test('Dockerfile: server-only CMD, copies the migration runner, no db push startup', () => {
  assert.match(dockerfile, /CMD \["node", "dist\/index\.js"\]/, 'CMD is server-only')
  assert.ok(dockerfile.includes('COPY --from=build /app/server/scripts ./scripts'), 'copies scripts/ for the pre-deploy command')
  assert.ok(!/run", "start:prod"/.test(dockerfile) || pkg.scripts['start:prod'] === 'node dist/index.js', 'start:prod (if used) is server-only')
  assert.ok(!/prisma\s+db\s+push/.test(dockerfile), 'no db push in the Dockerfile')
})
