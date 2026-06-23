import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listDeviceApps, getAppPreferences, setAppVisibility, subscribeDeviceApps,
  enqueueCommand, watchCommand, type DeviceApp,
} from '@/services/device-commands'

/** Lifecycle of a "Refresh Apps" (agent re-detect) request, surfaced truthfully in the UI. */
export type RefreshStatus = 'idle' | 'queued' | 'running' | 'done' | 'failed'

/**
 * Real installed-app inventory + the signed-in user's visibility prefs for one device.
 * Shared by the Phone Control Apps tab AND the Fleet drawer Launch App area so there is a
 * SINGLE real source — never two fake lists. `installed` is what the agent detected
 * (device_apps, installed = true); `visibleApps` is that minus the apps THIS user hid.
 * Default visibility is shown (no pref row = visible). Re-loads on a device_apps realtime
 * change (e.g. after the agent re-detects). No-op outside supabase-mode (`enabled`).
 *
 * `refreshApps()` enqueues ONE real `refresh_apps` command for the ACTIVE device and reports its
 * REAL lifecycle (queued → running → done/failed) via `refreshStatus`/`refreshError` — no fake
 * success, the failure (e.g. "WDA not healthy") is shown, and it can never stick (terminal or a
 * timeout always resolves it). Dedup: a second call while one is in flight is ignored.
 */
export function useDeviceApps(deviceId: string | null, teamId: string | null, userId: string | null, enabled: boolean) {
  const [installed, setInstalled] = useState<DeviceApp[]>([])
  const [prefs, setPrefs] = useState<Map<string, boolean>>(new Map())
  const [loading, setLoading] = useState(false)
  const [refreshStatus, setRefreshStatus] = useState<RefreshStatus>('idle')
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const reqRef = useRef(0) // increments per load() — only the LATEST request's result is applied
  // Refresh-command state, tracked in refs so dedup/cancel are synchronous + closure-safe.
  const refreshStateRef = useRef<RefreshStatus>('idle')
  const refreshTokenRef = useRef(0) // bumps per refresh + on device switch → stale watchers are ignored
  const refreshCancelRef = useRef<() => void>(() => {})
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setRefresh = useCallback((status: RefreshStatus, error: string | null) => {
    refreshStateRef.current = status
    if (!mountedRef.current) return
    setRefreshStatus(status); setRefreshError(error)
  }, [])
  const clearRefreshTimers = useCallback(() => {
    refreshCancelRef.current(); refreshCancelRef.current = () => {}
    if (refreshTimerRef.current) { clearTimeout(refreshTimerRef.current); refreshTimerRef.current = null }
  }, [])

  const load = useCallback(async () => {
    const token = ++reqRef.current
    if (!enabled || !deviceId) { setInstalled([]); setPrefs(new Map()); setLoading(false); return }
    setLoading(true)
    try {
      const [apps, p] = await Promise.all([listDeviceApps(deviceId), getAppPreferences(deviceId)])
      // Drop a stale resolution: a newer load() (device switch / realtime) superseded this one. Prevents
      // the previous device's inventory from landing on the current device.
      if (!mountedRef.current || token !== reqRef.current) return
      setInstalled(apps)
      setPrefs(new Map(p.map((x) => [x.bundleId, x.visible])))
    } catch {
      /* keep the prior lists; never crash the surface */
    } finally {
      if (mountedRef.current && token === reqRef.current) setLoading(false)
    }
  }, [enabled, deviceId])

  // Ask the agent to re-detect the installed inventory for the ACTIVE device. Truthful lifecycle; on
  // success the device_apps realtime change reloads the list (and we also refetch explicitly).
  const refreshApps = useCallback(() => {
    if (!enabled || !deviceId || !teamId || !userId) return
    if (refreshStateRef.current === 'queued' || refreshStateRef.current === 'running') return // dedup — no storm
    const token = ++refreshTokenRef.current
    const target = deviceId
    clearRefreshTimers()
    setRefresh('queued', null)
    const settle = (status: RefreshStatus, error: string | null) => {
      if (token !== refreshTokenRef.current) return // a newer refresh / device switch superseded this one
      clearRefreshTimers()
      setRefresh(status, error)
    }
    enqueueCommand({ teamId, deviceId: target, action: 'refresh_apps', userId })
      .then(({ id }) => {
        if (token !== refreshTokenRef.current) return
        const cancel = watchCommand(id, (status, error) => {
          if (!mountedRef.current || token !== refreshTokenRef.current) { cancel(); return }
          if (status === 'running') setRefresh('running', null)
          else if (status === 'acked') { settle('done', null); void load() } // re-detected → refetch inventory
          else if (status === 'failed') settle('failed', error || 'refresh failed')
          else if (status === 'expired') settle('failed', 'command expired')
        }, { intervalMs: 1000, timeoutMs: 60000 })
        refreshCancelRef.current = cancel
        // Safety net: if the command never reaches a terminal state (e.g. claimed but the agent stalls →
        // stuck 'delivered'), fail truthfully instead of spinning forever.
        refreshTimerRef.current = setTimeout(() => settle('failed', 'no response from the device agent (timed out)'), 60000)
      })
      .catch((e) => settle('failed', e instanceof Error ? e.message : 'could not enqueue refresh'))
  }, [enabled, deviceId, teamId, userId, load, setRefresh, clearRefreshTimers])

  // Reset EVERYTHING immediately when the device changes: clear inventory + cancel any in-flight refresh so
  // a previous device's apps/lifecycle can never show for the new device. Realtime reloads keep deviceId,
  // so they don't reset here (no flicker).
  useEffect(() => {
    refreshTokenRef.current++ // invalidate any in-flight refresh watcher for the old device
    clearRefreshTimers()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset on device change
    setInstalled([]); setPrefs(new Map()); setRefreshStatus('idle'); setRefreshError(null)
    refreshStateRef.current = 'idle'
  }, [deviceId, clearRefreshTimers])

  useEffect(() => {
    mountedRef.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() sets loading/lists; intentional on mount / device change
    void load()
    const unsub = enabled && deviceId ? subscribeDeviceApps(deviceId, () => void load()) : () => {}
    return () => { mountedRef.current = false; unsub() }
  }, [load, enabled, deviceId])

  useEffect(() => () => { mountedRef.current = false; clearRefreshTimers() }, [clearRefreshTimers])

  // An app is visible unless the user EXPLICITLY hid it (default = shown).
  const isVisible = useCallback((bundleId: string) => prefs.get(bundleId) ?? true, [prefs])
  const visibleApps = installed.filter((a) => isVisible(a.bundleId))

  const setVisible = useCallback(async (bundleId: string, visible: boolean) => {
    if (!teamId || !userId || !deviceId) return
    setPrefs((prev) => { const next = new Map(prev); next.set(bundleId, visible); return next }) // optimistic
    const r = await setAppVisibility({ userId, teamId, deviceId, bundleId, visible })
    if (r.error) void load() // failed to persist → re-sync from the source of truth
  }, [teamId, userId, deviceId, load])

  return { installed, visibleApps, isVisible, setVisible, loading, refresh: load, refreshApps, refreshStatus, refreshError }
}
