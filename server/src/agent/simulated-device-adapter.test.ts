import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SimulatedDeviceControlAdapter } from './simulated-device-adapter'
import type { DeviceIdentity } from './types'

const ID: DeviceIdentity = { udid: 'udid-1', name: 'Test iPhone', model: 'iPhone 15', osVersion: 'iOS 18.2', platform: 'ios' }

test('attach makes a device discoverable; detach removes it', async () => {
  const a = new SimulatedDeviceControlAdapter()
  assert.deepEqual(await a.listAttachedUdids(), [])
  a.attach(ID)
  assert.deepEqual(await a.listAttachedUdids(), ['udid-1'])
  a.detach('udid-1')
  assert.deepEqual(await a.listAttachedUdids(), [])
})

test('getIdentity returns the stable identity; throws for an unattached UDID', async () => {
  const a = new SimulatedDeviceControlAdapter()
  a.attach(ID)
  assert.deepEqual(await a.getIdentity('udid-1'), ID)
  await assert.rejects(() => a.getIdentity('nope'), /not attached/)
})

test('startWda makes WDA healthy and assigns the port; stopWda clears it', async () => {
  const a = new SimulatedDeviceControlAdapter()
  a.attach(ID)
  assert.equal(await a.isWdaHealthy('udid-1'), false)
  await a.startWda('udid-1', 8100)
  assert.equal(await a.isWdaHealthy('udid-1'), true)
  await a.stopWda('udid-1')
  assert.equal(await a.isWdaHealthy('udid-1'), false)
})

test('startWda failure path is forceable', async () => {
  const a = new SimulatedDeviceControlAdapter()
  a.attach(ID)
  a.failWdaFor('udid-1')
  await assert.rejects(() => a.startWda('udid-1', 8100), /WDA failed to start/)
  assert.equal(await a.isWdaHealthy('udid-1'), false)
})

test('execute requires healthy WDA and returns a screenshot reference (no secrets)', async () => {
  const a = new SimulatedDeviceControlAdapter()
  a.attach(ID)
  await assert.rejects(() => a.execute('udid-1', { kind: 'tap', x: 1, y: 2 }), /WDA not healthy/)
  await a.startWda('udid-1', 8100)
  const shot = await a.execute('udid-1', { kind: 'screenshot' })
  assert.match(String((shot.result as { screenshot?: string }).screenshot), /^sim:\/\//)
  const tap = await a.execute('udid-1', { kind: 'tap', x: 10, y: 20 })
  assert.deepEqual(tap, {})
})

test('failNextExecute forces the configured number of execute failures', async () => {
  const a = new SimulatedDeviceControlAdapter()
  a.attach(ID)
  await a.startWda('udid-1', 8100)
  a.failNextExecute(1, 'WDA_TIMEOUT')
  await assert.rejects(() => a.execute('udid-1', { kind: 'home' }))
  // the failure budget is spent → the next call succeeds
  assert.deepEqual(await a.execute('udid-1', { kind: 'home' }), {})
})

test('re-attach of the same UDID preserves the stable key (reconnect-by-UDID)', async () => {
  const a = new SimulatedDeviceControlAdapter()
  a.attach(ID)
  await a.startWda('udid-1', 8100)
  a.attach({ ...ID, name: 'Renamed' }) // re-plug
  // Same UDID is still the single attached device — never a duplicate.
  assert.deepEqual(await a.listAttachedUdids(), ['udid-1'])
  assert.equal((await a.getIdentity('udid-1')).name, 'Renamed')
})
