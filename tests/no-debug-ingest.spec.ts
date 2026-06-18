import { test, expect } from 'playwright/test'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * Regression guard: a debugging agent once injected a fetch to a local debug
 * "ingest" sink (http://127.0.0.1:7627/ingest/...) into the app boot path. That
 * instrumentation must never ship again. This test fails if any shipped source
 * file reintroduces the endpoint or its #region agent-log markers.
 *
 * Runs in the `engine` project (Node, no browser/server).
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCAN_ROOTS = ['src', 'index.html'].map((p) => join(ROOT, p))

// Markers of the injected debug instrumentation. Kept as fragments so a renamed
// session id or location still trips the guard.
const FORBIDDEN = ['7627', '/ingest/', '#region agent log', 'X-Debug-Session-Id', 'hypothesisId']

function collect(target: string): string[] {
  if (!existsSync(target)) return []
  if (statSync(target).isFile()) return [target]
  const out: string[] = []
  for (const entry of readdirSync(target)) {
    const full = join(target, entry)
    if (statSync(full).isDirectory()) out.push(...collect(full))
    else if (/\.(ts|tsx|js|jsx|mjs|cjs|css|html)$/.test(entry)) out.push(full)
  }
  return out
}

test('shipped source contains no debug-ingest endpoint or agent-log markers', () => {
  const files = SCAN_ROOTS.flatMap(collect)
  expect(files.length, 'expected to scan at least src/main.tsx + index.html').toBeGreaterThan(0)

  const offenders: string[] = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const needle of FORBIDDEN) {
      if (text.includes(needle)) offenders.push(`${file.replace(ROOT, '.')} :: contains "${needle}"`)
    }
  }
  expect(offenders, `debug instrumentation found in shipped source:\n${offenders.join('\n')}`).toEqual([])
})
