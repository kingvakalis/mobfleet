import { test } from 'node:test'
import assert from 'node:assert/strict'
// The inventory tool is a throwaway ESM ops script (.mjs); importing it does NOT connect
// (the runner is guarded by isMain()). We import the pure, exported helpers.
import { pgClientConfig, isRelaxedTls, SAFE } from '../ops/prod-readiness-inventory.mjs'

/**
 * TLS handling is DERIVED from the URL's sslmode by pg-connection-string (no hand-rolled
 * TLS). These tests pin the contract: STRICT by default; relaxed (rejectUnauthorized:false)
 * ONLY when the URL explicitly sets sslmode=no-verify. Plus: errors never leak credentials.
 */
const URL_NONE = 'postgresql://u:p@h:5432/db'
const URL_REQUIRE = 'postgresql://u:p@h:5432/db?sslmode=require'
const URL_VERIFY = 'postgresql://u:p@h:5432/db?sslmode=verify-full'
const URL_NOVERIFY = 'postgresql://u:p@h:5432/db?sslmode=no-verify'

const rejectUnauthorizedOf = (cfg: { ssl?: unknown }): unknown =>
  (cfg.ssl as { rejectUnauthorized?: unknown } | undefined)?.rejectUnauthorized

// ── strict TLS by default ────────────────────────────────────────────────────
test('strict TLS by default: no sslmode / verify-full / require never relaxes', () => {
  assert.equal(isRelaxedTls(URL_NONE), false)
  assert.equal(isRelaxedTls(URL_VERIFY), false)
  assert.equal(isRelaxedTls(URL_REQUIRE), false) // require aliases to verify-full → still strict
  assert.notEqual(rejectUnauthorizedOf(pgClientConfig(URL_VERIFY)), false)
  assert.notEqual(rejectUnauthorizedOf(pgClientConfig(URL_NONE)), false)
})

// ── relaxed TLS ONLY on explicit opt-in ────────────────────────────────────────
test('relaxed TLS ONLY with explicit sslmode=no-verify (for Railway self-signed proxy)', () => {
  assert.equal(isRelaxedTls(URL_NOVERIFY), true)
  assert.equal(rejectUnauthorizedOf(pgClientConfig(URL_NOVERIFY)), false)
})

test('pgClientConfig parses host/database from the URL (delegates to pg-connection-string)', () => {
  const cfg = pgClientConfig(URL_VERIFY)
  assert.equal(cfg.host, 'h')
  assert.equal(cfg.database, 'db')
})

// ── no secret output ───────────────────────────────────────────────────────────
test('SAFE redacts any connection URL — credentials never surface in errors', () => {
  const msg = SAFE(new Error('connect failed: postgresql://user:s3cretPW@host:5432/db?sslmode=require'))
  assert.equal(msg.includes('s3cretPW'), false)
  assert.equal(msg.includes('postgresql://'), false)
  assert.match(msg, /<redacted-url>/)
})
