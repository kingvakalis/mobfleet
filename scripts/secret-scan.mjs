#!/usr/bin/env node
/**
 * SECRET SCANNER (release validation, Subagent 5).
 *
 * Greps the committed source tree for REAL secret material that must never be
 * checked in: Supabase service_role JWTs, Stripe/Resend live keys, PEM private
 * keys, generic long JWTs, AWS keys, etc. Designed for a pre-release / CI gate.
 *
 * It is deliberately conservative to avoid false positives:
 *   - Skips node_modules, .git, dist, build, coverage, lockfiles, and this script.
 *   - IGNORES anything that is clearly a reference, not a value: `process.env.X`,
 *     `import.meta.env.X`, *.example / .env.example files, and obvious placeholders
 *     (your-…, xxxx, <…>, •••• masks, changeme, example).
 *   - Matches VALUE-shaped tokens (real key prefixes + sufficient entropy/length),
 *     not the variable NAMES (so documenting `RESEND_API_KEY` in prose is fine).
 *
 * Exit code: 0 = clean, 1 = at least one likely real secret found, 2 = usage error.
 *
 * Usage:  node scripts/secret-scan.mjs [rootDir]
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.argv[2] ? process.argv[2] : join(fileURLToPath(import.meta.url), '..', '..')
const SELF = fileURLToPath(import.meta.url)

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.vercel', '.turbo',
  'playwright-report', 'test-results', '.cache',
])
const SCAN_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|env|yaml|yml|toml|md|html|css|sh|txt)$/i

// Files whose VERY PURPOSE is to hold placeholders / references — never real secrets.
const ALLOW_FILE = /(\.example$|\.sample$|\.env\.example|\.env\.sample|example\.)/i

// A token is treated as a REFERENCE (not a value) and ignored if the surrounding
// text shows it's read from the environment or is an obvious placeholder.
// `secret-scan-ignore` lets a test fixture intentionally plant a fake secret.
const REFERENCE_HINT = /(process\.env|import\.meta\.env|^\s*#|YOUR_|your-|example|placeholder|changeme|xxxxx|<[^>]+>|•|\*\*\*\*|\.\.\.|secret-scan-ignore)/

/**
 * Secret patterns. Each must match a VALUE shape with enough specificity that a
 * normal source token won't trip it. `label` is shown on a hit.
 */
const PATTERNS = [
  { label: 'Stripe live secret key', re: /\bsk_live_[0-9a-zA-Z]{20,}\b/ },
  { label: 'Stripe live restricted key', re: /\brk_live_[0-9a-zA-Z]{20,}\b/ },
  { label: 'Resend live API key', re: /\bre_[0-9a-zA-Z]{20,}\b/ },
  { label: 'PEM private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/ },
  { label: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'GitHub token', re: /\bgh[pousr]_[0-9A-Za-z]{30,}\b/ },
  { label: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { label: 'Slack token', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  // Supabase service_role JWT: a JWT (eyJ…) whose payload decodes to role:service_role.
  { label: 'JWT (verify it is not a service_role key)', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, jwt: true },
]

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    let st
    try { st = statSync(full) } catch { continue }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue
      out.push(...walk(full))
    } else if (SCAN_EXT.test(entry) && full !== SELF && !/package-lock\.json$|pnpm-lock\.yaml$|yarn\.lock$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

/** Decode a JWT payload (best-effort) and report whether it's a Supabase service_role key. */
function isServiceRoleJwt(token) {
  try {
    const payload = token.split('.')[1]
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    const obj = JSON.parse(json)
    return obj && (obj.role === 'service_role' || obj.role === 'supabase_admin')
  } catch {
    return false
  }
}

const files = statSync(ROOT).isDirectory() ? walk(ROOT) : [ROOT]
const findings = []

for (const file of files) {
  if (ALLOW_FILE.test(basename(file))) continue
  let text
  try { text = readFileSync(file, 'utf8') } catch { continue }
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const p of PATTERNS) {
      const m = line.match(p.re)
      if (!m) continue
      // A reference/placeholder on the same line → not a real secret.
      if (REFERENCE_HINT.test(line)) continue
      if (p.jwt) {
        // Only a service_role/admin JWT is a finding; ordinary anon JWTs aren't secrets.
        if (!isServiceRoleJwt(m[0])) continue
      }
      findings.push({
        file: relative(ROOT, file),
        line: i + 1,
        label: p.label,
        // Never print the full secret — show a redacted preview.
        preview: `${m[0].slice(0, 6)}…${m[0].slice(-4)}`,
      })
    }
  }
}

if (findings.length === 0) {
  console.log(`secret-scan: clean — scanned ${files.length} files, no real secrets found.`)
  process.exit(0)
}

console.error(`secret-scan: FOUND ${findings.length} likely secret(s):`)
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}  [${f.label}]  ${f.preview}`)
}
console.error('\nRemove the secret, rotate it, and store it in an environment variable instead.')
process.exit(1)
