import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { verifyHs256, checkClaims, JwtError, type JwtPayload } from './jwt'

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function sign(payload: JwtPayload, secret: string, header: object = { alg: 'HS256', typ: 'JWT' }): string {
  const si = `${b64(header)}.${b64(payload)}`
  const sig = createHmac('sha256', secret).update(si).digest('base64url')
  return `${si}.${sig}`
}
const future = Math.floor(Date.now() / 1000) + 3600
const past = Math.floor(Date.now() / 1000) - 3600

test('verifyHs256 accepts a valid token and returns the payload', () => {
  const tok = sign({ sub: 'u1', email: 'A@B.com', exp: future }, 'secret')
  const p = verifyHs256(tok, 'secret')
  assert.equal(p.sub, 'u1')
})

test('verifyHs256 rejects a tampered signature', () => {
  const tok = sign({ sub: 'u1', exp: future }, 'secret')
  const tampered = tok.slice(0, -2) + (tok.endsWith('aa') ? 'bb' : 'aa')
  assert.throws(() => verifyHs256(tampered, 'secret'), JwtError)
})

test('verifyHs256 rejects a token signed with a different secret', () => {
  const tok = sign({ sub: 'u1', exp: future }, 'secret')
  assert.throws(() => verifyHs256(tok, 'other-secret'), JwtError)
})

test('verifyHs256 rejects an expired token', () => {
  const tok = sign({ sub: 'u1', exp: past }, 'secret')
  assert.throws(() => verifyHs256(tok, 'secret'), JwtError)
})

test('verifyHs256 rejects a non-HS256 alg (alg confusion)', () => {
  const tok = sign({ sub: 'u1', exp: future }, 'secret', { alg: 'none', typ: 'JWT' })
  assert.throws(() => verifyHs256(tok, 'secret'), JwtError)
})

test('verifyHs256 requires a secret', () => {
  const tok = sign({ sub: 'u1', exp: future }, 'secret')
  assert.throws(() => verifyHs256(tok, ''), JwtError)
})

test('checkClaims enforces audience and issuer', () => {
  assert.throws(() => checkClaims({ aud: 'x', exp: future }, { audience: 'y' }), JwtError)
  assert.throws(() => checkClaims({ iss: 'x', exp: future }, { issuer: 'y' }), JwtError)
  // matching aud/iss + valid exp passes
  checkClaims({ aud: 'y', iss: 'z', exp: future }, { audience: 'y', issuer: 'z' })
})

test('checkClaims honours nbf (not-before)', () => {
  assert.throws(() => checkClaims({ nbf: future, exp: future }, {}), JwtError)
})

test('checkClaims rejects a token with no exp (never-expiring)', () => {
  assert.throws(() => checkClaims({ sub: 'u1' }, {}), JwtError)
})
