import { createMockProvider } from './mock-provider'
import type { ProviderClient } from './types'

export * from './types'

/**
 * THE SWAP POINT. The whole app talks to the fleet through `client`.
 * To go live, replace this with an HTTP-backed ProviderClient — nothing
 * else in the UI changes.
 */
export const client: ProviderClient = createMockProvider()

// Dev affordance: poke the fleet from the console (e.g. __fleet.createDevices(4)).
if (import.meta.env.DEV) {
  ;(globalThis as unknown as { __fleet?: ProviderClient }).__fleet = client
}
