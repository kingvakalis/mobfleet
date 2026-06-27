/**
 * Relay auth — validates browser VIEWER tokens + agent PUBLISHER keys against the Supabase RPCs
 * (anon key only; NO service-role). Injectable so the server can be unit-tested with fakes.
 *   • redeemViewer  → public.redeem_stream_token(token, deviceId)  (device-scoped, unexpired)
 *   • resolvePublisher → public.resolve_stream_publisher(deviceKey) → device_id
 */
export interface RelayAuth {
  redeemViewer(token: string, deviceId: string): Promise<boolean>
  resolvePublisher(deviceKey: string): Promise<string | null>
}

export function supabaseAuth(supabaseUrl: string, anonKey: string): RelayAuth {
  const base = supabaseUrl.replace(/\/+$/, '')
  const rpc = async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
    const res = await fetch(`${base}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`rpc ${fn} HTTP ${res.status}`)
    return res.json()
  }
  return {
    async redeemViewer(token, deviceId) {
      // redeem_stream_token returns a non-empty row set for a valid, unexpired, device-matching token;
      // an invalid/expired/mismatched token RAISES → PostgREST 4xx → caught → false.
      try {
        const r = await rpc('redeem_stream_token', { p_token: token, p_device_id: deviceId })
        return Array.isArray(r) ? r.length > 0 : Boolean(r)
      } catch { return false }
    },
    async resolvePublisher(deviceKey) {
      // resolve_stream_publisher returns the device_id (uuid scalar) for a valid key, else RAISES.
      try {
        const r = await rpc('resolve_stream_publisher', { p_device_key: deviceKey })
        return typeof r === 'string' && r.length > 0 ? r : null
      } catch { return null }
    },
  }
}
