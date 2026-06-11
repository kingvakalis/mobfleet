export type View = 'fleet' | 'jobs' | 'automations' | 'proxies' | 'groups'

export const VIEWS: { id: View; label: string }[] = [
  { id: 'fleet', label: 'FLEET' },
  { id: 'jobs', label: 'JOBS' },
  { id: 'automations', label: 'AUTOMATIONS' },
  { id: 'proxies', label: 'PROXIES' },
  { id: 'groups', label: 'GROUPS' },
]
