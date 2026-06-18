import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WdaPortAllocator } from './wda-port-allocator'

test('allocate is stable per UDID (same device → same port)', () => {
  const a = new WdaPortAllocator(8100, 10)
  const p1 = a.allocate('udid-A')
  const p2 = a.allocate('udid-A')
  assert.equal(p1, p2)
  assert.equal(p1, 8100)
})

test('distinct UDIDs get distinct ports from the base up', () => {
  const a = new WdaPortAllocator(8100, 10)
  assert.equal(a.allocate('A'), 8100)
  assert.equal(a.allocate('B'), 8101)
  assert.equal(a.allocate('C'), 8102)
  assert.equal(a.size, 3)
})

test('release frees a port and the next allocation reuses the lowest free slot', () => {
  const a = new WdaPortAllocator(8100, 10)
  a.allocate('A') // 8100
  a.allocate('B') // 8101
  a.release('A')
  assert.equal(a.portFor('A'), undefined)
  assert.equal(a.allocate('C'), 8100) // reuses the freed low slot
})

test('release is idempotent', () => {
  const a = new WdaPortAllocator(8100, 10)
  a.allocate('A')
  a.release('A')
  a.release('A') // no throw
  assert.equal(a.size, 0)
})

test('exhausting the range throws a clear error', () => {
  const a = new WdaPortAllocator(8100, 2)
  a.allocate('A')
  a.allocate('B')
  assert.throws(() => a.allocate('C'), /port range exhausted/)
})
