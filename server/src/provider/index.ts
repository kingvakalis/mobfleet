import { env } from '../env'
import type { FleetStore } from '../fleet-store'
import type { DeviceProvider } from './device-provider'
import { SimulatedDeviceAdapter } from './simulated-adapter'
import { CorelliumAdapter } from './corellium-adapter'
import { GeelarkAdapter } from './geelark-adapter'

/** Pick the device provider from env (default: credential-free simulator). */
export function createProvider(store: FleetStore): DeviceProvider {
  switch (env.provider) {
    case 'corellium':
      return new CorelliumAdapter(store)
    case 'geelark':
      return new GeelarkAdapter(store)
    default:
      return new SimulatedDeviceAdapter(store)
  }
}

export type { DeviceProvider }
