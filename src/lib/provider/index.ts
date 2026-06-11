import { createMockProvider } from './mock-provider'
import { createHttpProvider } from './http-provider'
import type { ProviderClient } from './types'

export * from './types'

/**
 * THE SWAP POINT. The whole app talks to the fleet through `client`.
 *  - VITE_USE_BACKEND set  → real HTTP+WS backend (createHttpProvider)
 *  - otherwise             → in-memory mock (createMockProvider)
 * The default stays mock so the standalone Vercel build is unaffected until a
 * backend URL is configured. Nothing else in the UI changes either way.
 */
const useBackend =
  import.meta.env.VITE_USE_BACKEND === '1' || import.meta.env.VITE_USE_BACKEND === 'true'

export const client: ProviderClient = useBackend ? createHttpProvider() : createMockProvider()

// Dev affordance: poke the fleet from the console (e.g. __fleet.createDevices(4)).
if (import.meta.env.DEV) {
  ;(globalThis as unknown as { __fleet?: ProviderClient }).__fleet = client
}
