import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeActivityCursor, decodeActivityCursor, parseActivityQuery } from './activity'

// Pure-function coverage of the Activity cursor codec + query parsing (no DB).

test('cursor round-trips createdAt + id', () => {
  const c = { createdAt: 1_700_000_000_123, id: 'aud_00000000-0000-0000-0000-000000000000' }
  assert.deepEqual(decodeActivityCursor(encodeActivityCursor(c)), c)
})

test('cursor preserves an id with underscores (the aud_ prefix); split is on the FIRST colon only', () => {
  const c = { createdAt: 42, id: 'aud_a_b_c' }
  assert.deepEqual(decodeActivityCursor(encodeActivityCursor(c)), c)
})

test('decodeActivityCursor rejects empty / no-separator / non-numeric / empty-id', () => {
  assert.equal(decodeActivityCursor(null), null)
  assert.equal(decodeActivityCursor(undefined), null)
  assert.equal(decodeActivityCursor(''), null)
  assert.equal(decodeActivityCursor(Buffer.from('nocolon', 'utf8').toString('base64url')), null)
  assert.equal(decodeActivityCursor(Buffer.from('abc:aud_1', 'utf8').toString('base64url')), null)
  assert.equal(decodeActivityCursor(Buffer.from('123:', 'utf8').toString('base64url')), null)
})

test('parseActivityQuery defaults to limit 50 / no cursor', () => {
  assert.deepEqual(parseActivityQuery({}), { limit: 50, cursor: null })
})

test('parseActivityQuery clamps limit to [1,100] and falls back to 50 on garbage', () => {
  assert.equal(parseActivityQuery({ limit: '10' }).limit, 10)
  assert.equal(parseActivityQuery({ limit: 10 }).limit, 10)
  assert.equal(parseActivityQuery({ limit: '999' }).limit, 100)
  assert.equal(parseActivityQuery({ limit: '0' }).limit, 1)
  assert.equal(parseActivityQuery({ limit: '-5' }).limit, 1)
  assert.equal(parseActivityQuery({ limit: 'abc' }).limit, 50)
})

test('parseActivityQuery decodes a valid cursor and nulls a malformed one (never widens scope)', () => {
  const c = { createdAt: 5, id: 'aud_x' }
  assert.deepEqual(parseActivityQuery({ cursor: encodeActivityCursor(c) }).cursor, c)
  assert.equal(parseActivityQuery({ cursor: 'garbage-no-colon' }).cursor, null)
  assert.equal(parseActivityQuery({ cursor: 123 }).cursor, null)
})
