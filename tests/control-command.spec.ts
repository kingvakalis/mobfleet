import { test, expect } from 'playwright/test'
import { createDeviceLogHub } from '../src/lib/provider/device-log-hub'
import { controlCommandToWire, formatCommandLog } from '../src/shared/control-command'
import type { DeviceCommandLogEntry } from '../src/shared/types'

/**
 * Pure-function tests (no browser, no server) for the client-side device-log
 * subscriber hub + the shared control-command helpers. Runs in the Playwright
 * `engine` project.
 */
const entry = (text: string): DeviceCommandLogEntry => ({ ts: 1, text })

test('device-log hub delivers entries to a device\'s subscribers', () => {
  const hub = createDeviceLogHub()
  const got: string[] = []
  const off = hub.subscribe('dev-1', (e) => got.push(e.text))
  hub.emit('dev-1', entry('Tap at 1, 2'))
  expect(got).toEqual(['Tap at 1, 2'])
  off()
})

test('device-log hub isolates devices — a log for A never reaches B', () => {
  const hub = createDeviceLogHub()
  const a: string[] = []
  const b: string[] = []
  hub.subscribe('A', (e) => a.push(e.text))
  hub.subscribe('B', (e) => b.push(e.text))
  hub.emit('A', entry('only-A'))
  expect(a).toEqual(['only-A'])
  expect(b).toEqual([])
})

test('device-log hub supports multiple subscribers and unsubscribes cleanly (no leak)', () => {
  const hub = createDeviceLogHub()
  const a: string[] = []
  const b: string[] = []
  const offA = hub.subscribe('dev', (e) => a.push(e.text))
  const offB = hub.subscribe('dev', (e) => b.push(e.text))
  expect(hub.count('dev')).toBe(2)
  hub.emit('dev', entry('one'))
  expect(a).toEqual(['one'])
  expect(b).toEqual(['one'])
  offA()
  expect(hub.count('dev')).toBe(1)
  hub.emit('dev', entry('two'))
  expect(a).toEqual(['one']) // unsubscribed → no further delivery
  expect(b).toEqual(['one', 'two'])
  offB()
  expect(hub.count('dev')).toBe(0) // empty set dropped — no map leak
})

test('device-log hub: emit with no subscribers is a no-op; a throwing subscriber cannot break the others', () => {
  const hub = createDeviceLogHub()
  expect(() => hub.emit('ghost', entry('x'))).not.toThrow()
  const good: string[] = []
  hub.subscribe('d', () => { throw new Error('bad subscriber') })
  hub.subscribe('d', (e) => good.push(e.text))
  expect(() => hub.emit('d', entry('ok'))).not.toThrow()
  expect(good).toEqual(['ok'])
})

test('control-command helpers are importable on the client and consistent', () => {
  expect(controlCommandToWire({ type: 'tap', deviceId: 'd', x: 9, y: 9 }))
    .toEqual({ deviceId: 'd', action: 'tap', payload: { x: 9, y: 9 } })
  expect(controlCommandToWire({ type: 'key', deviceId: 'd', key: 'back' }))
    .toEqual({ deviceId: 'd', action: 'back' })
  // typed text is reduced to a character count — never the text itself
  expect(formatCommandLog('type', { text: 'secret' })).toBe('Typed 6 characters')
})
