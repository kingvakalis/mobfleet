import 'dotenv/config'

function str(name: string, fallback: string): string {
  const v = process.env[name]
  return v && v.length > 0 ? v : fallback
}
function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name]
  if (v === undefined) return fallback
  return v === '1' || v.toLowerCase() === 'true'
}

const nodeEnv = str('NODE_ENV', 'development')
const isProd = nodeEnv === 'production'

export const env = {
  nodeEnv,
  isProd,
  port: Number(str('PORT', '8787')),
  databaseUrl: str('DATABASE_URL', 'file:./dev.db'),
  allowedOrigin: str('ALLOWED_ORIGIN', '*'),
  provider: str('PROVIDER', 'simulated') as 'simulated' | 'corellium' | 'geelark',

  // ── Auth / multi-tenancy ──────────────────────────────────────────────────
  // How the JWT the client sends is verified.
  //   supabase → HS256 JWT verified with SUPABASE_JWT_SECRET (Supabase: Project
  //              Settings → API → JWT Secret)
  //   dev      → INSECURE decode-only (no signature check) — local dev ONLY,
  //              requires ALLOW_INSECURE_DEV_AUTH=1.
  authProvider: str('AUTH_PROVIDER', isProd ? 'supabase' : 'dev').trim().toLowerCase() as 'supabase' | 'dev',
  /** Explicit opt-in required to run the signature-less 'dev' verifier. */
  allowInsecureDevAuth: bool('ALLOW_INSECURE_DEV_AUTH', false),
  /** Supabase project JWT secret (HS256). Required in prod for supabase.
   *  Falls back to the legacy AUTH_JWT_SECRET name. */
  authJwtSecret: str('SUPABASE_JWT_SECRET', '') || str('AUTH_JWT_SECRET', ''),
  /** Expected audience / issuer (Supabase: aud="authenticated",
   *  iss="https://<ref>.supabase.co/auth/v1"). Optional but recommended. */
  authAudience: str('AUTH_AUDIENCE', ''),
  authIssuer: str('AUTH_ISSUER', ''),

  /** Public base URL of the web app — used to build invite-accept links. */
  appUrl: str('APP_URL', 'http://localhost:5173'),
  /** How long an invite stays valid (ms). Default 7 days. */
  inviteTtlMs: Number(str('INVITE_TTL_MS', String(7 * 24 * 60 * 60 * 1000))),

  /** First login with no membership auto-creates a personal team (owner). */
  autoProvisionTeam: bool('AUTO_PROVISION_TEAM', true),
}

/**
 * Fail CLOSED on a misconfigured auth setup. Runs unconditionally (not only in
 * prod): a silent fallback to the signature-less verifier — whether via an unset
 * NODE_ENV, a typo'd AUTH_PROVIDER, or a missing secret — would be a complete
 * auth bypass that defeats all tenant isolation. So the only way to reach the
 * insecure 'dev' verifier is an explicit, local-only opt-in.
 */
export function assertAuthConfig() {
  const valid = ['supabase', 'dev']
  if (!valid.includes(env.authProvider)) {
    throw new Error(`[env] AUTH_PROVIDER must be one of ${valid.join('|')}, got ${JSON.stringify(env.authProvider)}`)
  }
  if (env.authProvider === 'dev') {
    if (env.isProd) throw new Error('[env] AUTH_PROVIDER=dev is forbidden in production. Set supabase.')
    if (!env.allowInsecureDevAuth) {
      throw new Error('[env] AUTH_PROVIDER=dev verifies NO signature. Set ALLOW_INSECURE_DEV_AUTH=1 to opt in (local dev only).')
    }
  }
  if (env.authProvider === 'supabase' && !env.authJwtSecret) {
    throw new Error('[env] AUTH_PROVIDER=supabase requires SUPABASE_JWT_SECRET.')
  }
}
