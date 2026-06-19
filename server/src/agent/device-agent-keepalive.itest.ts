import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/**
 * Regression guard for the supabase-mode keep-alive bug.
 *
 * The AgentRuntime's periodic timers are all .unref()'d (so they never hang a test
 * process). In me-mode the HttpWsAgentTransport's WebSocket is a ref'd handle that
 * keeps the daemon alive; the SupabaseAgentTransport is HTTP-poll-only with NO
 * persistent socket. Before the fix, a `--transport supabase` agent therefore exited
 * 0 immediately after `agent.boot` — before it ever sent a heartbeat or polled — so a
 * paired device showed up but never went online and no command was ever executed.
 *
 * device-agent.ts now holds a ref'd keep-alive interval for the daemon's lifetime.
 * This test spawns the REAL agent process in supabase + simulate mode, points it at a
 * local mock Supabase that records the RPCs it receives, and proves that AFTER boot the
 * process (a) opens a device session, (b) heartbeats repeatedly, and (c) is still
 * running. Pre-fix this fails because no heartbeat RPC ever arrives.
 *
 * Self-contained (no DB, no network beyond loopback) — runs anywhere via `npm run test:it`.
 */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
async function waitFor(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true
    await sleep(50)
  }
  return pred()
}

const scriptPath = fileURLToPath(new URL('../scripts/device-agent.ts', import.meta.url))
const serverCwd = fileURLToPath(new URL('../../', import.meta.url))
const UDID = 'sim-keepalive-itest'

test('supabase-mode device-agent keeps running and heartbeats after boot', { timeout: 30_000 }, async () => {
  const calls: string[] = []
  // Mock Supabase RPC endpoint: record the fn name, return shapes the transport expects.
  const server = http.createServer((req, res) => {
    const fn = (req.url ?? '').replace(/^\/rest\/v1\/rpc\//, '').replace(/\?.*$/, '')
    req.resume() // drain the request body
    req.on('end', () => {
      calls.push(fn)
      res.setHeader('Content-Type', 'application/json')
      if (fn === 'device_session_start') res.end(JSON.stringify('sess-itest'))
      else if (fn === 'claim_device_commands') res.end('[]')
      else res.end('null')
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  assert.ok(port > 0, 'mock server must bind a port')

  const child = spawn(
    process.execPath,
    ['--import', 'tsx', scriptPath, '--simulate', '--transport', 'supabase'],
    {
      cwd: serverCwd,
      env: {
        ...process.env,
        SUPABASE_URL: `http://127.0.0.1:${port}`,
        SUPABASE_ANON_KEY: 'anon-itest',
        // Pre-provisioned creds (skip the claim path) + a simulated attached device.
        AGENT_DEVICES: `${UDID}=dev-itest:key-itest`,
        SIM_DEVICES: UDID,
        // Fast, deterministic loops.
        DISCOVERY_INTERVAL_MS: '150',
        HEARTBEAT_INTERVAL_MS: '250',
        WDA_CHECK_INTERVAL_MS: '1000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let out = ''
  child.stdout.on('data', (d) => { out += String(d) })
  child.stderr.on('data', (d) => { out += String(d) })
  let exitCode: number | null = null
  child.on('exit', (code) => { exitCode = code })

  try {
    const heartbeats = (): number => calls.filter((c) => c === 'device_heartbeat').length
    const got = await waitFor(() => heartbeats() >= 2, 15_000)
    assert.ok(
      got,
      `expected >=2 device_heartbeat RPCs after boot, got ${heartbeats()} ` +
        `(calls=[${calls.join(',')}], exitCode=${exitCode}). Output:\n${out}`,
    )
    // The crux: still running after heartbeats. Pre-fix the process is already gone.
    assert.equal(exitCode, null, `agent must stay alive after boot (keep-alive); it exited with ${exitCode}`)
    assert.ok(calls.includes('device_session_start'), 'agent should open a device session on first heartbeat')
    assert.match(out, /"event":"agent\.boot"[^}]*"transport":"supabase"/, 'should boot in supabase transport mode')
  } finally {
    child.kill()
    await waitFor(() => exitCode !== null, 5_000)
    await new Promise<void>((r) => server.close(() => r()))
  }
})
