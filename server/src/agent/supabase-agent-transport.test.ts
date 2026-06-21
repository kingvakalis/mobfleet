import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SupabaseAgentTransport, rowToFrame, rpcRequest } from './supabase-agent-transport'

/** A fetch mock that records {fn, body} per RPC call and returns a canned result per function. */
function mockFetch(resForFn: Record<string, unknown> = {}) {
  const calls: Array<{ fn: string; body: Record<string, unknown>; headers: Record<string, string> }> = []
  const fetchImpl = async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
    const fn = url.split('/rpc/')[1]
    calls.push({ fn, body: JSON.parse(init?.body ?? '{}'), headers: init?.headers ?? {} })
    const res = fn in resForFn ? resForFn[fn] : null
    return { ok: true, status: 200, text: async () => JSON.stringify(res) }
  }
  return { calls, fetchImpl }
}
const mk = (fetchImpl: any, over: Record<string, unknown> = {}) =>
  new SupabaseAgentTransport({ supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'ANON', deviceId: 'dev1', deviceKey: 'KEY', fetchImpl, ...over })

test('rpcRequest builds the Supabase RPC url + anon headers', () => {
  const r = rpcRequest('https://x.supabase.co/', 'ANON', 'claim_device_commands', { p_device_key: 'K' })
  assert.equal(r.url, 'https://x.supabase.co/rest/v1/rpc/claim_device_commands')
  assert.equal(r.headers.apikey, 'ANON')
  assert.equal(r.headers.Authorization, 'Bearer ANON')
  assert.deepEqual(JSON.parse(r.body), { p_device_key: 'K' })
})

test('rowToFrame maps a valid row and rejects an invalid action', () => {
  const f = rowToFrame({ id: 'c1', action: 'tap', payload: { x: 1 }, created_at: '2026-06-19T00:00:00Z' }, 'dev1')
  assert.equal(f?.commandId, 'c1'); assert.equal(f?.action, 'tap'); assert.equal(f?.deviceId, 'dev1')
  assert.equal(rowToFrame({ id: 'c2', action: 'not-a-real-action' }, 'dev1'), null)
})

test('pollCommands calls claim_device_commands with the device key + maps/filters rows', async () => {
  const { calls, fetchImpl } = mockFetch({ claim_device_commands: [
    { id: 'c1', action: 'tap', payload: { x: 1, y: 2 }, created_at: '2026-06-19T00:00:00Z' },
    { id: 'c2', action: 'bogus' },
  ] })
  const frames = await mk(fetchImpl).pollCommands()
  assert.equal(calls[0].fn, 'claim_device_commands')
  assert.equal(calls[0].body.p_device_key, 'KEY')
  assert.equal(frames.length, 1)
  assert.equal(frames[0].commandId, 'c1')
})

test('markRunning calls start_agent_command', async () => {
  const { calls, fetchImpl } = mockFetch()
  await mk(fetchImpl).markRunning('c1')
  assert.deepEqual(calls[0], calls.find(c => c.fn === 'start_agent_command'))
  assert.equal(calls[0].body.p_command_id, 'c1')
  assert.equal(calls[0].body.p_device_key, 'KEY')
})

test('ackCommand maps success and failure', async () => {
  const ok = mockFetch(); await mk(ok.fetchImpl).ackCommand('c1', { success: true })
  assert.equal(ok.calls[0].fn, 'ack_agent_command')
  assert.equal(ok.calls[0].body.p_success, true); assert.equal(ok.calls[0].body.p_error, null)

  const bad = mockFetch(); await mk(bad.fetchImpl).ackCommand('c2', { success: false, error: { code: 'X', message: 'boom', retryable: false } })
  assert.equal(bad.calls[0].body.p_success, false); assert.equal(bad.calls[0].body.p_error, 'boom')
})

test('putScreenshot uploads via put_device_screenshot with the device key + frame', async () => {
  const { calls, fetchImpl } = mockFetch()
  await mk(fetchImpl).putScreenshot('c1', { base64: 'IMG', format: 'png', width: 390, height: 844 })
  assert.equal(calls[0].fn, 'put_device_screenshot')
  assert.equal(calls[0].body.p_device_key, 'KEY')
  assert.equal(calls[0].body.p_command_id, 'c1')
  assert.equal(calls[0].body.p_image_base64, 'IMG')
  assert.equal(calls[0].body.p_format, 'png')
  assert.equal(calls[0].body.p_width, 390)
  assert.equal(calls[0].body.p_height, 844)
})

test('putScreenshot accepts a null commandId (continuous-capture frame)', async () => {
  const { calls, fetchImpl } = mockFetch()
  await mk(fetchImpl).putScreenshot(null, { base64: 'IMG', format: 'jpeg', width: 390, height: 844 })
  assert.equal(calls[0].fn, 'put_device_screenshot')
  assert.equal(calls[0].body.p_command_id, null)
  assert.equal(calls[0].body.p_format, 'jpeg')
})

test('sendHeartbeat opens a session once, then heartbeats, then ends on offline', async () => {
  const { calls, fetchImpl } = mockFetch({ device_session_start: 'sess-1' })
  const t = mk(fetchImpl, { agentVersion: 'agent/1.0' })
  await t.sendHeartbeat({ status: 'warming', battery: 50, cpuUsage: null, memoryUsage: null })
  assert.equal(calls[0].fn, 'device_session_start')
  assert.equal(calls[0].body.p_agent_version, 'agent/1.0')
  assert.equal(calls[1].fn, 'device_heartbeat')
  assert.equal(calls[1].body.p_session_id, 'sess-1')
  assert.equal(calls[1].body.p_status, 'warming')
  assert.equal(calls[1].body.p_battery, 50)

  await t.sendHeartbeat({ status: 'online', battery: 60, cpuUsage: 10, memoryUsage: 20 })
  assert.equal(calls.filter(c => c.fn === 'device_session_start').length, 1) // not re-opened
  assert.equal(calls[2].fn, 'device_heartbeat')

  await t.sendHeartbeat({ status: 'offline', battery: null, cpuUsage: null, memoryUsage: null })
  const last = calls[calls.length - 1]
  assert.equal(last.fn, 'device_session_end')
  assert.equal(last.body.p_session_id, 'sess-1')
})
