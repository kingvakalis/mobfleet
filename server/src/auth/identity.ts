import { env } from '../env'
import { checkClaims, decodeJwt, verifyHs256, verifyRs256, JwtError, type JwtPayload } from './jwt'
import { getJwks } from './jwks'

/** A verified external identity — the provider-agnostic result of auth. */
export interface Identity {
  /** Stable provider subject (Clerk/Supabase user id). */
  providerUserId: string
  email: string
  name?: string
  /** Whether the identity provider has verified the email address. Gates
   *  invite acceptance so a leaked invite link can't be redeemed by someone who
   *  merely typed the victim's address at the IdP. */
  emailVerified: boolean
}

export class AuthError extends Error {}

/** Pull email/name from the common claim shapes across providers. */
function extract(payload: JwtPayload): Identity {
  const sub = typeof payload.sub === 'string' ? payload.sub : ''
  if (!sub) throw new AuthError('token missing sub')
  const email =
    (typeof payload.email === 'string' && payload.email) ||
    // Clerk often nests these as custom claims; allow common fallbacks.
    (typeof payload['email_address'] === 'string' && (payload['email_address'] as string)) ||
    (typeof payload['primary_email'] === 'string' && (payload['primary_email'] as string)) ||
    ''
  const name =
    (typeof payload.name === 'string' && payload.name) ||
    (typeof payload['full_name'] === 'string' && (payload['full_name'] as string)) ||
    undefined
  if (!email) throw new AuthError('token missing email claim')
  // Supabase: email_verified (bool) / email_confirmed_at (string). Clerk:
  // email_verified in the session claims. Be strict — only an explicit truthy
  // signal counts as verified.
  const emailVerified =
    payload['email_verified'] === true ||
    payload['email_verified'] === 'true' ||
    payload['email_confirmed'] === true ||
    typeof payload['email_confirmed_at'] === 'string'
  return { providerUserId: sub, email: email.toLowerCase(), name, emailVerified }
}

const claimChecks = () => ({
  audience: env.authAudience || undefined,
  issuer: env.authIssuer || undefined,
})

/**
 * Verify a bearer token and resolve it to an Identity, per AUTH_PROVIDER:
 *   supabase → HS256 with AUTH_JWT_SECRET
 *   clerk    → RS256 against AUTH_JWKS_URL
 *   dev      → INSECURE decode-only (signature NOT checked) — local dev only.
 */
export async function verifyToken(token: string): Promise<Identity> {
  if (!token) throw new AuthError('missing token')
  try {
    switch (env.authProvider) {
      case 'supabase':
        return extract(verifyHs256(token, env.authJwtSecret, claimChecks()))
      case 'clerk': {
        const { header } = decodeJwt(token)
        // Refresh once if the kid isn't in the cached set (key rotation).
        let keys = await getJwks(env.authJwksUrl)
        if (header.kid && !keys.some((k) => (k as { kid?: string }).kid === header.kid)) {
          keys = await getJwks(env.authJwksUrl, { forceRefresh: true })
        }
        return extract(verifyRs256(token, keys, claimChecks()))
      }
      case 'dev': {
        // INSECURE: decode only, still enforce expiry so stale tokens fail.
        // Local-only (assertAuthConfig forbids reaching here in prod); a dev
        // identity is treated as email-verified for frictionless local testing.
        const { payload } = decodeJwt(token)
        checkClaims(payload, claimChecks())
        return { ...extract(payload), emailVerified: true }
      }
      default:
        // Never fall through to the signature-less path on an unknown/typo'd
        // provider — that would be a silent auth bypass.
        throw new AuthError(`unknown AUTH_PROVIDER: ${env.authProvider}`)
    }
  } catch (e) {
    if (e instanceof AuthError) throw e
    throw new AuthError(e instanceof JwtError ? e.message : 'invalid token')
  }
}
