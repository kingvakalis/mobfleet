import { test, expect } from 'playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * Release-validation guard (Subagent 5): runs scripts/secret-scan.mjs over the
 * committed source tree and FAILS the engine suite if any real secret is found.
 *
 * It also proves the scanner is not a no-op by running it against a temp dir that
 * contains a planted fake secret (expect exit 1) and a clean dir (expect exit 0).
 *
 * Runs in the `engine` project (Node, no browser/server).
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const SCRIPT = join(ROOT, 'scripts', 'secret-scan.mjs')

function runScan(target: string): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, target], { encoding: 'utf8' })
    return { code: 0, out }
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

test('the repository source tree contains no real secrets', () => {
  const { code, out } = runScan(ROOT)
  expect(code, `secret-scan flagged the repo:\n${out}`).toBe(0)
})

test('secret-scan DETECTS a planted live key (proves it is not a no-op)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'secret-scan-'))
  try {
    // A Stripe-shaped live key as a real value (no env reference, no placeholder).
    // The literal below carries `secret-scan-ignore` so the repo-wide scan does not
    // flag THIS test file; the temp file we write has no such marker, so it IS flagged.
    const planted = ['sk', 'live', 'ABCDEFGHIJKLMNOPQRSTUVWX1234'].join('_') // secret-scan-ignore
    writeFileSync(join(dir, 'leak.ts'), `const k = "${planted}"\n`)
    const { code, out } = runScan(dir)
    expect(code, 'scanner should exit nonzero on a planted secret').toBe(1)
    expect(out).toMatch(/Stripe live secret key/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('secret-scan IGNORES env references and placeholders (no false positives)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'secret-scan-'))
  try {
    writeFileSync(
      join(dir, 'config.ts'),
      [
        'const key = process.env.RESEND_API_KEY',
        'const example = "sk_live_your-key-here"   // placeholder',
        'const masked = "re_••••1234"',
      ].join('\n') + '\n',
    )
    const { code } = runScan(dir)
    expect(code, 'env refs + placeholders must not be flagged').toBe(0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
