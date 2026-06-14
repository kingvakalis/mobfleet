export interface Region {
  id: string
  /** Short uppercase tag shown on nodes. */
  label: string
  /** Provider list price per device-hour (USD). */
  ratePerHour: number
}

export const REGIONS: Region[] = [
  { id: 'us-east-1', label: 'US-EAST', ratePerHour: 0.28 },
  { id: 'us-west-2', label: 'US-WEST', ratePerHour: 0.3 },
  { id: 'eu-west-1', label: 'EU-WEST', ratePerHour: 0.32 },
  { id: 'ap-south-1', label: 'AP-SOUTH', ratePerHour: 0.26 },
  { id: 'sa-east-1', label: 'SA-EAST', ratePerHour: 0.34 },
]

const RATE = new Map(REGIONS.map((r) => [r.id, r.ratePerHour]))
const LABEL = new Map(REGIONS.map((r) => [r.id, r.label]))

export function regionRate(id: string): number {
  return RATE.get(id) ?? 0.3
}

export function regionLabel(id: string): string {
  return LABEL.get(id) ?? id.toUpperCase()
}
