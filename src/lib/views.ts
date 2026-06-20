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
  /** Hidden + route-guarded in supabase-mode (VITE_AUTH_SOURCE=supabase). These
   *  pages are still mock/demo or backed by the (Railway) backend that the
   *  supabase-mode customer's JWT can't reach, so they must not surface real-
   *  looking-but-fake data to customers. The underlying page is kept in the
   *  codebase; only its sidebar entry + routes are gated. See isViewHiddenInSupabaseMode. */
  hideInSupabaseMode?: boolean
}

export const VIEWS: ViewMeta[] = [
  { id: 'fleet',       label: 'Fleet',            icon: 'network',    requiredAny: ['fleet.view'] },
  { id: 'phones',      label: 'Phones',           icon: 'smartphone', requiredAny: ['phones.view'] },
  { id: 'scale',       label: 'Scale',            icon: 'gauge',      requiredAny: ['phones.provision', 'phones.retire'], hideInSupabaseMode: true },
  { id: 'accounts',    label: 'Account Database', icon: 'database',   requiredAny: ['accounts.view'], hideInSupabaseMode: true },
  { id: 'groups',      label: 'Groups',           icon: 'layers',     requiredAny: ['groups.view'], hideInSupabaseMode: true },
  { id: 'team',        label: 'Team',             icon: 'users',      requiredAny: ['team.view', 'roles.view'] },
  { id: 'automations', label: 'Automations',      icon: 'zap',        requiredAny: ['automations.view'], hideInSupabaseMode: true },
  { id: 'jobs',        label: 'Jobs',             icon: 'briefcase',  requiredAny: ['jobs.view'] },
  { id: 'logs',        label: 'Activity',         icon: 'terminal',   requiredAny: ['activity.view'], hideInSupabaseMode: true },
  { id: 'settings',    label: 'Settings',         icon: 'settings',   requiredAny: ['settings.view'] },
]

/** View ids hidden + route-guarded when running in supabase-mode. Derived from the
 *  VIEWS flag so there is a single source of truth (the sidebar, the App route guard,
 *  and the command palette all consult this). `phone-control` is NOT here — it is the
 *  real Supabase phone-control sub-route and stays reachable. */
const HIDDEN_IN_SUPABASE = new Set<ViewId>(VIEWS.filter((v) => v.hideInSupabaseMode).map((v) => v.id))

/** True when this view must be hidden/guarded in supabase-mode. Callers combine it
 *  with the supabase-mode check (AUTH_SOURCE === 'supabase' && isSupabaseConfigured). */
export function isViewHiddenInSupabaseMode(id: ViewId): boolean {
  return HIDDEN_IN_SUPABASE.has(id)
}

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
  scale: ['phones.provision', 'phones.retire'],
  'phone-control': ['phones.view'],
}
