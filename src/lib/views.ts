import type { PermissionKey } from '@/lib/authorization/permissions'

export type ViewId =
  | 'fleet' | 'phones' | 'accounts' | 'groups' | 'team'
  | 'automations' | 'jobs' | 'scale' | 'logs' | 'settings' | 'phone-control'

export type View = ViewId

export interface ViewMeta {
  id: ViewId
  label: string
  icon: string
  /** Visible/openable when the user holds ANY of these. Centralized route
   *  access — the sidebar filters on it and App guards the active view. */
  requiredAny: PermissionKey[]
}

export const VIEWS: ViewMeta[] = [
  { id: 'fleet',       label: 'Fleet',            icon: 'network',    requiredAny: ['fleet.view'] },
  { id: 'phones',      label: 'Phones',           icon: 'smartphone', requiredAny: ['phones.view'] },
  { id: 'accounts',    label: 'Account Database', icon: 'database',   requiredAny: ['accounts.view'] },
  { id: 'groups',      label: 'Groups',           icon: 'layers',     requiredAny: ['groups.view'] },
  { id: 'team',        label: 'Team',             icon: 'users',      requiredAny: ['team.view', 'roles.view'] },
  { id: 'automations', label: 'Automations',      icon: 'zap',        requiredAny: ['automations.view'] },
  { id: 'jobs',        label: 'Jobs',             icon: 'briefcase',  requiredAny: ['jobs.view'] },
  { id: 'logs',        label: 'Activity',         icon: 'terminal',   requiredAny: ['activity.view'] },
  { id: 'settings',    label: 'Settings',         icon: 'settings',   requiredAny: ['settings.view'] },
]

/** Permissions that gate a route/view (used by the App-level guard). */
export const VIEW_REQUIRED: Record<ViewId, PermissionKey[]> = {
  fleet: ['fleet.view'],
  phones: ['phones.view'],
  accounts: ['accounts.view'],
  groups: ['groups.view'],
  team: ['team.view', 'roles.view'],
  automations: ['automations.view'],
  jobs: ['jobs.view'],
  logs: ['activity.view'],
  settings: ['settings.view'],
  scale: ['phones.import'],
  'phone-control': ['phones.view'],
}
