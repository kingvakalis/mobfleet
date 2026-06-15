import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatCommandResultError, completionLogText } from './command-completion'
import { commandResultBody } from '../../src/shared/schemas'

// The ackCommand persistence + team-scoped broadcast + WS/HTTP wiring exercise
// real Prisma + sockets — there's no DB/WS harness in this backend's pure
// node:test suite, so those are verified at runtime. These tests cover the pure,
// security-critical parts: result validation + completion-text formatting.

// ── commandResultBody validation ────────────────────────────────────────────
test('commandResultBody accepts a full agent result body', () => {
  assert.equal(commandResultBody.safeParse({ success: true, startedAt: 1, completedAt: 2, durationMs: 1, result: { url: 'x' } }).success, true)
})

test('commandResultBody accepts minimal bodies (incl. the HTTP-normalized shape)', () => {
  assert.equal(commandResultBody.safeParse({ success: true }).success, true)
  assert.equal(commandResultBody.safeParse({ success: false, error: { message: 'boom', code: 'WDA_UNHEALTHY', retryable: true } }).success, true)
})

test('commandResultBody rejects a missing/non-boolean success', () => {
  assert.equal(commandResultBody.safeParse({}).success, false)
  assert.equal(commandResultBody.safeParse({ success: 'yes' }).success, false)
})

// ── formatCommandResultError (safe failure suffix) ──────────────────────────
test('formatCommandResultError prefers error.message', () => {
  assert.equal(formatCommandResultError({ success: false, error: { message: 'Device offline' } }), 'Device offline')
})

test('formatCommandResultError falls back to code, then a generic message', () => {
  assert.equal(formatCommandResultError({ success: false, error: { code: 'WDA_UNHEALTHY' } }), 'WDA_UNHEALTHY')
  assert.equal(formatCommandResultError({ success: false }), 'Command failed')
  assert.equal(formatCommandResultError({ success: false, error: { message: '   ' } }), 'Command failed')
})

test('formatCommandResultError strips newlines/control chars and collapses whitespace', () => {
  assert.equal(formatCommandResultError({ success: false, error: { message: 'line1\nline2\r\n\tend' } }), 'line1 line2 end')
})

test('formatCommandResultError length-limits long messages', () => {
  const out = formatCommandResultError({ success: false, error: { message: 'x'.repeat(500) } })
  assert.ok(out.length <= 200, `expected ≤200, got ${out.length}`)
})

// ── completionLogText (the two-stage stage-2 line) ──────────────────────────
test('completionLogText appends ✓ on success', () => {
  assert.equal(completionLogText('Screenshot requested', { success: true }), 'Screenshot requested ✓')
})

test('completionLogText appends ✗ + safe error on failure', () => {
  assert.equal(
    completionLogText('Screenshot requested', { success: false, error: { message: 'Device offline' } }),
    'Screenshot requested ✗ Device offline',
  )
})

test('completionLogText uses generic failure text when there is no error message', () => {
  assert.equal(completionLogText('Tap at 1, 2', { success: false }), 'Tap at 1, 2 ✗ Command failed')
})

test('completionLogText never leaks the result payload into the log', () => {
  const out = completionLogText('Typed 5 characters', { success: true, result: { secret: 'should-not-appear' } })
  assert.equal(out.includes('should-not-appear'), false)
  assert.equal(out, 'Typed 5 characters ✓')
})
