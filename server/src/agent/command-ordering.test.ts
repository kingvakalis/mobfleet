import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commandPriority, orderDrainedCommands, CONTROL_ACTIONS } from './command-ordering'
import type { AgentCommandFrame } from './types'
import type { AgentCommandAction } from '../../../src/shared/schemas'

let seq = 0
const frame = (action: AgentCommandAction, issuedAt: number, id = `c${++seq}`): AgentCommandFrame =>
  ({ type: 'command', commandId: id, deviceId: 'dev', action, payload: {}, issuedAt })

test('control gestures are dispatched before screenshots in a mixed batch', () => {
  // claim order deliberately puts a screenshot first
  const batch = [frame('screenshot', 100), frame('tap', 101), frame('swipe', 102)]
  const { toRun } = orderDrainedCommands(batch)
  assert.deepEqual(toRun.map((f) => f.action), ['tap', 'swipe', 'screenshot'])
})

test('all listed control actions outrank a screenshot', () => {
  for (const action of ['tap', 'swipe', 'home', 'back', 'lock', 'unlock', 'switcher', 'launch', 'terminate', 'type'] as AgentCommandAction[]) {
    assert.ok(CONTROL_ACTIONS.has(action), `${action} should be a control action`)
    assert.ok(commandPriority(action) < commandPriority('screenshot'), `${action} must precede screenshot`)
  }
})

test('meta commands (install/reboot/refresh_apps) sit between control and screenshot', () => {
  for (const meta of ['install', 'reboot', 'refresh_apps'] as AgentCommandAction[]) {
    assert.equal(commandPriority(meta), 1)
    assert.ok(commandPriority('tap') < commandPriority(meta))
    assert.ok(commandPriority(meta) < commandPriority('screenshot'))
  }
})

test('stale screenshots are coalesced to the single newest; others superseded', () => {
  const old1 = frame('screenshot', 200, 'old1')
  const old2 = frame('screenshot', 205, 'old2')
  const newest = frame('screenshot', 210, 'newest')
  const { toRun, superseded } = orderDrainedCommands([old1, newest, old2])
  const shots = toRun.filter((f) => f.action === 'screenshot')
  assert.equal(shots.length, 1, 'exactly one screenshot survives (one frame capture per batch)')
  assert.equal(shots[0].commandId, 'newest')
  assert.deepEqual(superseded.map((f) => f.commandId).sort(), ['old1', 'old2'])
})

test('a single screenshot is kept and never superseded', () => {
  const { toRun, superseded } = orderDrainedCommands([frame('screenshot', 300, 'solo')])
  assert.equal(superseded.length, 0)
  assert.deepEqual(toRun.map((f) => f.commandId), ['solo'])
})

test('control commands keep FIFO order by issuedAt', () => {
  const a = frame('tap', 12, 'a')
  const b = frame('tap', 10, 'b')
  const c = frame('swipe', 11, 'c')
  const { toRun } = orderDrainedCommands([a, b, c])
  assert.deepEqual(toRun.map((f) => f.commandId), ['b', 'c', 'a'])
})

test('empty batch yields empty result', () => {
  const { toRun, superseded } = orderDrainedCommands([])
  assert.equal(toRun.length, 0)
  assert.equal(superseded.length, 0)
})

test('does not mutate the input array', () => {
  const batch = [frame('screenshot', 1, 'x'), frame('tap', 2, 'y')]
  const snapshot = batch.map((f) => f.commandId)
  orderDrainedCommands(batch)
  assert.deepEqual(batch.map((f) => f.commandId), snapshot)
})
