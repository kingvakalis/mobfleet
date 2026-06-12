export type ViewId =
  | 'fleet' | 'phones' | 'accounts' | 'groups' | 'team'
  | 'automations' | 'jobs' | 'scale' | 'logs' | 'settings' | 'phone-control'

export type View = ViewId

export interface ViewMeta {
  id: ViewId
  label: string
  icon: string
}

export const VIEWS: ViewMeta[] = [
  { id: 'fleet',       label: 'Fleet',            icon: 'network' },
  { id: 'phones',      label: 'Phones',           icon: 'smartphone' },
  { id: 'accounts',    label: 'Account Database', icon: 'database' },
  { id: 'groups',      label: 'Groups',           icon: 'layers' },
  { id: 'team',        label: 'Team',             icon: 'users' },
  { id: 'automations', label: 'Automations',      icon: 'zap' },
  { id: 'jobs',        label: 'Jobs',             icon: 'briefcase' },
  { id: 'logs',        label: 'Activity',         icon: 'terminal' },
  { id: 'settings',    label: 'Settings',         icon: 'settings' },
]
