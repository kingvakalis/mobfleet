/**
 * Minimal, dependency-free JWT verification (Node crypto only).
 * HS256 (shared secret) → Supabase access tokens (project JWT secret).
 *
 * Pure + synchronous; unit-tested in jwt.test.ts. We deliberately avoid a JWT
 * library so the trust surface is small and auditable — the only crypto is
 * Node's vetted `crypto` module.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export interface JwtHeader {
  alg: string
  kid?: string
  typ?: string
}
export interface JwtPayload {
  sub?: string
  email?: string
  name?: string
  aud?: string | string[]
  iss?: string
  exp?: number
  nbf?: number
  iat?: number
  [k: string]: unknown
}

export class JwtError extends Error {}

function b64urlToBuf(s: string): Buffer {
  return Buffer.from(s, 'base64url')
}
function b64urlToJson<T>(s: string): T {
  try {
    return JSON.parse(b64urlToBuf(s).toString('utf8')) as T
  } catch {
    throw new JwtError('malformed JWT segment')
  }
}

/** Split + decode without verifying the signature. NEVER trust this alone. */
export function decodeJwt(token: string): { header: JwtHeader; payload: JwtPayload; signingInput: string; signature: string } {
  const parts = token.split('.')
  if (parts.length !== 3) throw new JwtError('JWT must have 3 segments')
  const [h, p, sig] = parts
  return {
    header: b64urlToJson<JwtHeader>(h),
    payload: b64urlToJson<JwtPayload>(p),
    signingInput: `${h}.${p}`,
    signature: sig,
  }
}

export interface ClaimChecks {
  audience?: string
  issuer?: string
  /** Clock-skew tolerance in seconds (default 60). */
  clockToleranceSec?: number
  /** Override "now" (seconds) for deterministic tests. */
  nowSec?: number
}

/** Validate the registered time/audience/issuer claims. Throws on failure. */
export function checkClaims(payload: JwtPayload, checks: ClaimChecks = {}): void {
  const skew = checks.clockToleranceSec ?? 60
  const now = checks.nowSec ?? Math.floor(Date.now() / 1000)
  // Require an expiry — a token without exp would never go stale.
  if (typeof payload.exp !== 'number') throw new JwtError('token missing exp')
  if (now > payload.exp + skew) throw new JwtError('token expired')
  if (typeof payload.nbf === 'number' && now + skew < payload.nbf) throw new JwtError('token not yet valid')
  if (checks.issuer && payload.iss !== checks.issuer) throw new JwtError('issuer mismatch')
  if (checks.audience) {
    const aud = payload.aud
    const ok = Array.isArray(aud) ? aud.includes(checks.audience) : aud === checks.audience
    if (!ok) throw new JwtError('audience mismatch')
  }
}

/** Verify an HS256 token against a shared secret. Returns the payload. */
export function verifyHs256(token: string, secret: string, checks?: ClaimChecks): JwtPayload {
  if (!secret) throw new JwtError('missing HS256 secret')
  const { header, payload, signingInput, signature } = decodeJwt(token)
  if (header.alg !== 'HS256') throw new JwtError(`unexpected alg ${header.alg}`)
  const expected = createHmac('sha256', secret).update(signingInput).digest()
  const given = b64urlToBuf(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new JwtError('bad signature')
  }
  checkClaims(payload, checks)
  return payload
}
