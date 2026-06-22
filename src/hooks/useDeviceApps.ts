import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listDeviceApps, getAppPreferences, setAppVisibility, subscribeDeviceApps, type DeviceApp,
} from '@/services/device-commands'

/**
 * Real installed-app inventory + the signed-in user's visibility prefs for one device.
 * Shared by the Phone Control Apps tab AND the Fleet drawer Launch App area so there is a
 * SINGLE real source — never two fake lists. `installed` is what the agent detected
 * (device_apps, installed = true); `visibleApps` is that minus the apps THIS user hid.
 * Default visibility is shown (no pref row = visible). Re-loads on a device_apps realtime
 * change (e.g. after the agent re-detects). No-op outside supabase-mode (`enabled`).
 */
export function useDeviceApps(deviceId: string | null, teamId: string | null, userId: string | null, enabled: boolean) {
  const [installed, setInstalled] = useState<DeviceApp[]>([])
  const [prefs, setPrefs] = useState<Map<string, boolean>>(new Map())
  const [loading, setLoading] = useState(false)
  const mountedRef = useRef(true)
  const reqRef = useRef(0) // increments per load() — only the LATEST request's result is applied

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

  // Clear the previous device's inventory IMMEDIATELY when the device changes, so stale apps can never be
  // shown (or launched) for the NEW device while its real inventory loads. Realtime reloads keep the same
  // deviceId, so they don't clear here (no flicker).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset on device change
    setInstalled([]); setPrefs(new Map())
  }, [deviceId])

  useEffect(() => {
    mountedRef.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() sets loading/lists; intentional on mount / device change
    void load()
    const unsub = enabled && deviceId ? subscribeDeviceApps(deviceId, () => void load()) : () => {}
    return () => { mountedRef.current = false; unsub() }
  }, [load, enabled, deviceId])

  // An app is visible unless the user EXPLICITLY hid it (default = shown).
  const isVisible = useCallback((bundleId: string) => prefs.get(bundleId) ?? true, [prefs])
  const visibleApps = installed.filter((a) => isVisible(a.bundleId))

  const setVisible = useCallback(async (bundleId: string, visible: boolean) => {
    if (!teamId || !userId || !deviceId) return
    setPrefs((prev) => { const next = new Map(prev); next.set(bundleId, visible); return next }) // optimistic
    const r = await setAppVisibility({ userId, teamId, deviceId, bundleId, visible })
    if (r.error) void load() // failed to persist → re-sync from the source of truth
  }, [teamId, userId, deviceId, load])

  return { installed, visibleApps, isVisible, setVisible, loading, refresh: load }
}
