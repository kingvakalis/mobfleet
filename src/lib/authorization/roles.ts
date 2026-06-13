/**
 * Standard role templates. Roles provide sensible default permission sets and
 * an authority rank used for anti-escalation. The role name is never the sole
 * source of access — effective access is computed from role + per-user
 * grants/denials + scope (see effective-access.ts).
 */

import { ALL_PERMISSION_KEYS, type PermissionKey } from './permissions'

export type RoleId = 'owner' | 'admin' | 'manager' | 'operator' | 'viewer'

export interface RoleTemplate {
  id: RoleId
  name: string
  description: string
  /** Higher = more authority. An actor may only assign roles below their own
   *  rank and may only grant permissions they themselves hold. */
  rank: number
  /** System roles cannot be deleted; owner/admin permission sets are locked. */
  isSystem: boolean
  locked: boolean
  permissions: PermissionKey[]
}

const MANAGER_PERMS: PermissionKey[] = [
  'fleet.view', 'fleet.view_3d', 'fleet.save_layout',
  'phones.view', 'phones.control', 'phones.screenshot', 'phones.reboot',
  'phones.assign_group', 'phones.assign_employee',
  'groups.view', 'groups.edit', 'groups.assign_phones', 'groups.run_automation',
  'accounts.view', 'accounts.edit', 'accounts.assign',
  'automations.view', 'automations.run',
  'jobs.view', 'jobs.cancel', 'jobs.retry',
  'team.view', 'team.assign_phones', 'team.manage_shifts', 'team.view_all_shifts', 'team.export_reports',
  'activity.view',
  'settings.view',
]

const OPERATOR_PERMS: PermissionKey[] = [
  'fleet.view', 'fleet.view_3d',
  'phones.view', 'phones.control', 'phones.screenshot',
  'groups.view',
  'accounts.view',
  'automations.view', 'automations.run',
  'jobs.view',
  'activity.view',
]

const VIEWER_PERMS: PermissionKey[] = [
  'fleet.view', 'fleet.view_3d',
  'phones.view',
  'groups.view',
  'jobs.view',
  'activity.view',
]

export const ROLE_TEMPLATES: Record<RoleId, RoleTemplate> = {
  owner: {
    id: 'owner', name: 'Owner', rank: 100, isSystem: true, locked: true,
    description: 'Complete workspace authority, including ownership, billing, and security.',
    permissions: [...ALL_PERMISSION_KEYS],
  },
  admin: {
    id: 'admin', name: 'Admin', rank: 80, isSystem: true, locked: true,
    description: 'Full operational and team administration — cannot transfer ownership or delete the workspace.',
    permissions: ALL_PERMISSION_KEYS.filter(
      (k) => k !== 'workspace.transfer_ownership' && k !== 'workspace.delete' && k !== 'billing.manage',
    ),
  },
  manager: {
    id: 'manager', name: 'Manager', rank: 60, isSystem: true, locked: false,
    description: 'Operational lead for assigned groups — manages phones, jobs, and operators in scope.',
    permissions: MANAGER_PERMS,
  },
  operator: {
    id: 'operator', name: 'Operator', rank: 40, isSystem: true, locked: false,
    description: 'Hands-on device operator — controls assigned phones and runs approved automations.',
    permissions: OPERATOR_PERMS,
  },
  viewer: {
    id: 'viewer', name: 'Viewer', rank: 20, isSystem: true, locked: false,
    description: 'Read-only access to authorized fleet status, jobs, and activity.',
    permissions: VIEWER_PERMS,
  },
}

export const ROLE_ORDER: RoleId[] = ['owner', 'admin', 'manager', 'operator', 'viewer']

export function roleRank(id: RoleId): number {
  return ROLE_TEMPLATES[id]?.rank ?? 0
}
