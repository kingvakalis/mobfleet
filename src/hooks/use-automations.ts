import { useEffect, useState } from 'react'
import { client } from '@/lib/provider'
import { AUTOMATIONS } from '@/data/automations'
import type { Automation } from '@/shared/types'

/**
 * Automations from the provider. Renders the static presets instantly, then
 * adopts the provider's list (DB-backed run counts in backend mode; identical
 * presets in mock mode).
 */
export function useAutomations(): Automation[] {
  const [list, setList] = useState<Automation[]>(AUTOMATIONS)
  useEffect(() => {
    let active = true
    client
      .listAutomations()
      .then((a) => {
        if (active && a.length) setList(a)
      })
      .catch(() => {
        /* keep static fallback */
      })
    return () => {
      active = false
    }
  }, [])
  return list
}
