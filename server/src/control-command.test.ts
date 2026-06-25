import { test } from 'node:test'
import assert from 'node:assert/strict'
import { controlCommandSchema, agentCommandBody } from '../../src/shared/schemas'
import { controlCommandToWire, formatCommandLog, commandTypeForAction } from '../../src/shared/control-command'
import type { ControlCommand } from '../../src/shared/types'
import { registerBrowserLogSocket, broadcastCommandLog } from './command-log-hub'

const D = 'dev-1'

// ── controlCommandSchema (the typed UI shape) ───────────────────────────────────
test('controlCommandSchema accepts every well-formed command', () => {
  const ok: ControlCommand[] = [
    { type: 'tap', deviceId: D, x: 120, y: 340 },
    { type: 'swipe', deviceId: D, dir: 'up' },
    { type: 'key', deviceId: D, key: 'home' },
    { type: 'key', deviceId: D, key: 'switcher' },
    { type: 'launch_app', deviceId: D, appName: 'Instagram' },
    { type: 'screenshot', deviceId: D },
    { type: 'type_text', deviceId: D, text: 'hello' },
  ]
  for (const c of ok) assert.equal(controlCommandSchema.safeParse(c).success, true, c.type)
})

test('controlCommandSchema rejects malformed commands', () => {
  assert.equal(controlCommandSchema.safeParse({ type: 'tap', deviceId: D, x: Number.NaN, y: 1 }).success, false)
  assert.equal(controlCommandSchema.safeParse({ type: 'tap', deviceId: D, x: Infinity, y: 1 }).success, false)
  assert.equal(controlCommandSchema.safeParse({ type: 'tap', deviceId: D, x: 1 }).success, false) // missing y
  assert.equal(controlCommandSchema.safeParse({ type: 'swipe', deviceId: D, dir: 'sideways' }).success, false)
  assert.equal(controlCommandSchema.safeParse({ type: 'key', deviceId: D, key: 'volume' }).success, false)
  assert.equal(controlCommandSchema.safeParse({ type: 'launch_app', deviceId: D, appName: '' }).success, false)
  assert.equal(controlCommandSchema.safeParse({ type: 'type_text', deviceId: D, text: 'x'.repeat(5001) }).success, false)
  assert.equal(controlCommandSchema.safeParse({ type: 'type_text', deviceId: D, text: '' }).success, false)
  assert.equal(controlCommandSchema.safeParse({ type: 'shell', deviceId: D }).success, false) // unknown type
  assert.equal(controlCommandSchema.safeParse({ type: 'tap', x: 1, y: 2 }).success, false) // missing deviceId
})

// ── agentCommandBody (the wire body the SERVER validates) ───────────────────────
test('agentCommandBody enforces per-action payloads', () => {
  assert.equal(agentCommandBody.safeParse({ deviceId: D, action: 'tap', payload: { x: 10, y: 20 } }).success, true)
  assert.equal(agentCommandBody.safeParse({ deviceId: D, action: 'tap', payload: { x: 'a', y: 20 } }).success, false)
  assert.equal(agentCommandBody.safeParse({ deviceId: D, action: 'tap' }).success, false) // no coords
  assert.equal(agentCommandBody.safeParse({ deviceId: D, action: 'swipe', payload: { dir: 'up' } }).success, true)
  assert.equal(agentCommandBody.safeParse({ deviceId: D, action: 'swipe', payload: { dir: 'nope' } }).success, false)
  assert.equal(agentCommandBody.safeParse({ deviceId: D, action: 'type', payload: { text: 'hi' } }).success, true)
  assert.equal(agentCommandBody.safeParse({ deviceId: D, action: 'type', payload: { text: '' } }).success, false)
  assert.equal(agentCommandBody.safeParse({ deviceId: D, action: 'type', payload: { text: 'x'.repeat(5001) } }).success, false)
  assert.equal(agentCommandBody.safeParse({ deviceId: D, action: 'launch', payload: { appName: 'Safari' } }).success, true)
  assert.equal(agentCommandBody.safeParse({ deviceId: D, action: 'launch', payload: {} }).success, false)
  // payload-less actions (incl. the new back/switcher) are valid without payload
  for (const action of ['screenshot', 'home', 'back', 'lock', 'switcher', 'reboot'] as const) {
    assert.equal(agentCommandBody.safeParse({ deviceId: D, action }).success, true, action)
  }
  assert.equal(agentCommandBody.safeParse({ deviceId: D, action: 'shell' }).success, false) // unknown action
})

// ── controlCommandToWire ────────────────────────────────────────────────────────
test('controlCommandToWire maps each command to the wire shape', () => {
  assert.deepEqual(controlCommandToWire({ type: 'tap', deviceId: D, x: 5, y: 6 }), { deviceId: D, action: 'tap', payload: { x: 5, y: 6 } })
  assert.deepEqual(controlCommandToWire({ type: 'swipe', deviceId: D, dir: 'left' }), { deviceId: D, action: 'swipe', payload: { dir: 'left' } })
  assert.deepEqual(controlCommandToWire({ type: 'key', deviceId: D, key: 'back' }), { deviceId: D, action: 'back' })
  assert.deepEqual(controlCommandToWire({ type: 'key', deviceId: D, key: 'switcher' }), { deviceId: D, action: 'switcher' })
  assert.deepEqual(controlCommandToWire({ type: 'launch_app', deviceId: D, appName: 'X' }), { deviceId: D, action: 'launch', payload: { appName: 'X' } })
  assert.deepEqual(controlCommandToWire({ type: 'screenshot', deviceId: D }), { deviceId: D, action: 'screenshot', payload: {} })
  assert.deepEqual(controlCommandToWire({ type: 'type_text', deviceId: D, text: 'hi' }), { deviceId: D, action: 'type', payload: { text: 'hi' } })
})

test('controlCommandToWire carries + clamps the screenshot quality level', () => {
  assert.deepEqual(controlCommandToWire({ type: 'screenshot', deviceId: D, quality: 22 }), { deviceId: D, action: 'screenshot', payload: { quality: 22 } })
  assert.deepEqual(controlCommandToWire({ type: 'screenshot', deviceId: D, quality: 0 }), { deviceId: D, action: 'screenshot', payload: { quality: 0 } })
  assert.deepEqual(controlCommandToWire({ type: 'screenshot', deviceId: D, quality: 99 }), { deviceId: D, action: 'screenshot', payload: { quality: 30 } }) // clamped
  // the server validator accepts the quality-bearing screenshot, and rejects an out-of-range one
  assert.equal(agentCommandBody.safeParse({ deviceId: D, action: 'screenshot', payload: { quality: 15 } }).success, true)
  assert.equal(agentCommandBody.safeParse({ deviceId: D, action: 'screenshot', payload: { quality: 99 } }).success, false)
  assert.equal(controlCommandSchema.safeParse({ type: 'screenshot', deviceId: D, quality: 15 }).success, true)
  assert.equal(controlCommandSchema.safeParse({ type: 'screenshot', deviceId: D, quality: 31 }).success, false)
})

test('every controlCommandToWire output satisfies the server validator', () => {
  const cmds: ControlCommand[] = [
    { type: 'tap', deviceId: D, x: 5, y: 6 },
    { type: 'swipe', deviceId: D, dir: 'down' },
    { type: 'key', deviceId: D, key: 'home' },
    { type: 'key', deviceId: D, key: 'switcher' },
    { type: 'launch_app', deviceId: D, appName: 'X' },
    { type: 'screenshot', deviceId: D },
    { type: 'type_text', deviceId: D, text: 'hi' },
  ]
  for (const c of cmds) assert.equal(agentCommandBody.safeParse(controlCommandToWire(c)).success, true, c.type)
})

// ── formatCommandLog ────────────────────────────────────────────────────────────
test('formatCommandLog renders one line per action and never logs typed text', () => {
  assert.equal(formatCommandLog('tap', { x: 284, y: 516 }), 'Tap at 284, 516')
  assert.equal(formatCommandLog('swipe', { dir: 'up' }), 'Swipe up')
  assert.equal(formatCommandLog('home'), 'Pressed Home')
  assert.equal(formatCommandLog('back'), 'Pressed Back')
  assert.equal(formatCommandLog('lock'), 'Locked device')
  assert.equal(formatCommandLog('switcher'), 'Opened app switcher')
  assert.equal(formatCommandLog('launch', { appName: 'Instagram' }), 'Opened app: Instagram')
  assert.equal(formatCommandLog('screenshot'), 'Screenshot requested')
  const secret = 'super-secret-password'
  const line = formatCommandLog('type', { text: secret })
  assert.equal(line, `Typed ${secret.length} characters`)
  assert.equal(line.includes(secret), false) // typed text never leaks into the log
})

test('commandTypeForAction maps wire actions back to ControlCommand types', () => {
  assert.equal(commandTypeForAction('tap'), 'tap')
  assert.equal(commandTypeForAction('home'), 'key')
  assert.equal(commandTypeForAction('back'), 'key')
  assert.equal(commandTypeForAction('switcher'), 'key')
  assert.equal(commandTypeForAction('launch'), 'launch_app')
  assert.equal(commandTypeForAction('type'), 'type_text')
  assert.equal(commandTypeForAction('reboot'), undefined)
})

// ── command-log-hub (team-scoped browser broadcast) ─────────────────────────────
test('broadcastCommandLog reaches only the same team and unregisters cleanly', () => {
  const teamA: unknown[] = []
  const teamB: unknown[] = []
  const offA = registerBrowserLogSocket('clh-team-A', (f) => teamA.push(f))
  const offB = registerBrowserLogSocket('clh-team-B', (f) => teamB.push(f))
  broadcastCommandLog('clh-team-A', { type: 'command_log', deviceId: D, entry: { ts: 1, text: 'Tap at 1, 2' } })
  assert.equal(teamA.length, 1)
  assert.equal(teamB.length, 0) // never crosses teams
  offA()
  broadcastCommandLog('clh-team-A', { type: 'command_log', deviceId: D, entry: { ts: 2, text: 'x' } })
  assert.equal(teamA.length, 1) // unsubscribed → no more delivery
  offB()
})
