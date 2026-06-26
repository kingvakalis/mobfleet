/**
 * Centralized permission catalog — the single source of truth for every
 * permission key in MobFleet. Never scatter raw permission strings through the
 * codebase; import `PERMISSIONS` / `PermissionKey` from here.
 *
 * Keys follow `resource.action`. Each carries a human label, description, UI
 * category, and risk level so the access UI can render meaningfully and so
 * critical grants can demand stronger confirmation.
 *
 * ENFORCEMENT NOTE: this catalog is shared, portable logic. In the deployed
 * Vite SPA it is enforced at the single `client` provider seam + UI guards.
 * When the Fastify/Prisma backend (see DEPLOY.md / server/) is wired, the same
 * catalog + effective-access engine must run server-side as the source of
 * truth — the keys here are that contract.
 */

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export type PermissionCategory =
  | 'Fleet' | 'Phones' | 'Groups' | 'Account Database' | 'Automations'
  | 'Jobs' | 'Team' | 'Roles & Permissions' | 'Activity' | 'Settings'
  | 'Billing' | 'Workspace Security'

export interface PermissionDef {
  key: string
  category: PermissionCategory
  label: string
  description: string
  risk: RiskLevel
}

export const PERMISSIONS = [
  // ── Fleet ──────────────────────────────────────────────────────────────
  { key: 'fleet.view',         category: 'Fleet', label: 'View fleet',        description: 'See the fleet constellation and device map.', risk: 'low' },
  { key: 'fleet.view_3d',      category: 'Fleet', label: 'View 3D fleet',     description: 'Open the 3D fleet visualization.', risk: 'low' },
  { key: 'fleet.save_layout',  category: 'Fleet', label: 'Save fleet layout', description: 'Persist custom node positions and pins for the workspace.', risk: 'low' },

  // ── Phones ─────────────────────────────────────────────────────────────
  { key: 'phones.view',           category: 'Phones', label: 'View phones',          description: 'See phones within the assigned scope.', risk: 'low' },
  { key: 'phones.view_all',       category: 'Phones', label: 'View all phones',      description: 'See every phone in the workspace, ignoring group/phone scope.', risk: 'medium' },
  { key: 'phones.control',        category: 'Phones', label: 'Control phones',       description: 'Open the live stream and drive the screen (tap, swipe, type, launch apps).', risk: 'high' },
  { key: 'phones.screenshot',     category: 'Phones', label: 'Screenshot / record',  description: 'Capture screenshots and recordings of controlled phones.', risk: 'medium' },
  { key: 'phones.reboot',         category: 'Phones', label: 'Reboot phones',        description: 'Remotely reboot phones within scope.', risk: 'high' },
  { key: 'phones.assign_group',   category: 'Phones', label: 'Assign phone groups',  description: 'Move phones between groups.', risk: 'medium' },
  { key: 'phones.assign_employee',category: 'Phones', label: 'Assign phone operator',description: 'Assign employees to phones.', risk: 'medium' },
  { key: 'phones.rename',         category: 'Phones', label: 'Rename phones',        description: 'Change a phone’s display name. Owner/Admin by default; grant to other roles per member.', risk: 'medium' },
  { key: 'phones.retire',         category: 'Phones', label: 'Retire phones',        description: 'Permanently remove phones from the pool.', risk: 'critical' },
  { key: 'phones.provision',      category: 'Phones', label: 'Provision phones',     description: 'Provision new cloud devices into the fleet (billable on real providers).', risk: 'high' },
  { key: 'phones.import',         category: 'Phones', label: 'Import phones',        description: 'Bulk-import devices into the fleet.', risk: 'medium' },
  { key: 'phones.export',         category: 'Phones', label: 'Export phones',        description: 'Export the device registry.', risk: 'medium' },

  // ── Groups ─────────────────────────────────────────────────────────────
  { key: 'groups.view',            category: 'Groups', label: 'View groups',          description: 'See groups within scope.', risk: 'low' },
  { key: 'groups.create',          category: 'Groups', label: 'Create groups',        description: 'Create new device groups.', risk: 'medium' },
  { key: 'groups.edit',            category: 'Groups', label: 'Edit groups',          description: 'Rename groups and edit membership.', risk: 'medium' },
  { key: 'groups.assign_phones',   category: 'Groups', label: 'Assign phones to groups', description: 'Add or remove phones from a group.', risk: 'medium' },
  { key: 'groups.run_automation',  category: 'Groups', label: 'Run group automations',description: 'Dispatch automations across a group.', risk: 'high' },

  // ── Account Database ───────────────────────────────────────────────────
  { key: 'accounts.view',            category: 'Account Database', label: 'View accounts',          description: 'See account metadata (handle, platform, status).', risk: 'low' },
  { key: 'accounts.create',          category: 'Account Database', label: 'Create accounts',        description: 'Add account records.', risk: 'medium' },
  { key: 'accounts.edit',            category: 'Account Database', label: 'Edit accounts',          description: 'Modify account records.', risk: 'medium' },
  { key: 'accounts.delete',          category: 'Account Database', label: 'Delete accounts',        description: 'Permanently delete account records.', risk: 'high' },
  { key: 'accounts.import',          category: 'Account Database', label: 'Import accounts',        description: 'Bulk-import account records from CSV.', risk: 'medium' },
  { key: 'accounts.export',          category: 'Account Database', label: 'Export accounts',        description: 'Export account records (scope-filtered).', risk: 'high' },
  { key: 'accounts.reveal_password', category: 'Account Database', label: 'Reveal passwords',       description: 'Unmask and copy account passwords. Logged on every reveal.', risk: 'critical' },
  { key: 'accounts.reveal_recovery', category: 'Account Database', label: 'Reveal recovery data',   description: 'Unmask email/phone recovery information. Logged on every reveal.', risk: 'critical' },
  { key: 'accounts.assign',          category: 'Account Database', label: 'Assign accounts',        description: 'Assign accounts to phones, groups, and owners.', risk: 'medium' },

  // ── Automations ────────────────────────────────────────────────────────
  { key: 'automations.view',    category: 'Automations', label: 'View automations',   description: 'See automation definitions.', risk: 'low' },
  { key: 'automations.create',  category: 'Automations', label: 'Create automations', description: 'Build new automations.', risk: 'medium' },
  { key: 'automations.edit',    category: 'Automations', label: 'Edit automations',   description: 'Modify automation steps and settings.', risk: 'medium' },
  { key: 'automations.run',     category: 'Automations', label: 'Run automations',    description: 'Dispatch automations onto phones within scope.', risk: 'high' },
  { key: 'automations.delete',  category: 'Automations', label: 'Delete automations', description: 'Remove automations.', risk: 'high' },

  // ── Jobs ───────────────────────────────────────────────────────────────
  { key: 'jobs.view',     category: 'Jobs', label: 'View jobs',     description: 'See jobs within scope.', risk: 'low' },
  { key: 'jobs.view_all', category: 'Jobs', label: 'View all jobs', description: 'See every job, ignoring scope.', risk: 'medium' },
  { key: 'jobs.cancel',   category: 'Jobs', label: 'Cancel jobs',   description: 'Cancel running or queued jobs.', risk: 'medium' },
  { key: 'jobs.retry',    category: 'Jobs', label: 'Retry jobs',    description: 'Retry failed jobs.', risk: 'medium' },
  { key: 'jobs.export',   category: 'Jobs', label: 'Export jobs',   description: 'Export the job pipeline.', risk: 'medium' },

  // ── Team ───────────────────────────────────────────────────────────────
  { key: 'team.view',              category: 'Team', label: 'View team',              description: 'See the employee roster within scope.', risk: 'low' },
  { key: 'team.view_all',          category: 'Team', label: 'View all employees',     description: 'See every employee, not just managed ones.', risk: 'medium' },
  { key: 'team.invite',            category: 'Team', label: 'Invite employees',       description: 'Send workspace invitations.', risk: 'high' },
  { key: 'team.edit',              category: 'Team', label: 'Edit employees',         description: 'Edit employee profile and access.', risk: 'high' },
  { key: 'team.suspend',           category: 'Team', label: 'Suspend employees',      description: 'Suspend or reinstate workspace access.', risk: 'high' },
  { key: 'team.remove',            category: 'Team', label: 'Remove employees',       description: 'Remove employees from the workspace.', risk: 'critical' },
  { key: 'team.assign_groups',     category: 'Team', label: 'Assign employee groups', description: 'Set which groups an employee may access.', risk: 'high' },
  { key: 'team.assign_phones',     category: 'Team', label: 'Assign employee phones', description: 'Set which phones an employee may access.', risk: 'high' },
  { key: 'team.manage_shifts',     category: 'Team', label: 'Manage shifts',          description: 'Start, end, and edit employee shifts.', risk: 'medium' },
  { key: 'team.view_all_shifts',   category: 'Team', label: 'View all shift data',    description: 'See shift and time-tracking data for all employees (not just self/managed).', risk: 'medium' },
  { key: 'team.export_reports',    category: 'Team', label: 'Export team reports',    description: 'Export shift and time-tracking reports.', risk: 'medium' },

  // ── Roles & Permissions ────────────────────────────────────────────────
  { key: 'roles.view',               category: 'Roles & Permissions', label: 'View roles',          description: 'See role definitions and the permission matrix.', risk: 'low' },
  { key: 'roles.assign',             category: 'Roles & Permissions', label: 'Assign roles',        description: 'Change an employee’s role (within authority ceiling).', risk: 'critical' },
  { key: 'roles.manage_permissions', category: 'Roles & Permissions', label: 'Manage permissions',  description: 'Edit role permissions and per-user overrides.', risk: 'critical' },

  // ── Activity ───────────────────────────────────────────────────────────
  { key: 'activity.view',           category: 'Activity', label: 'View activity',           description: 'See operational activity within scope.', risk: 'low' },
  { key: 'activity.view_all',       category: 'Activity', label: 'View all activity',       description: 'See workspace-wide activity, including other employees.', risk: 'medium' },
  { key: 'activity.view_security',  category: 'Activity', label: 'View security audit',     description: 'See the security audit log (role/permission/ownership events).', risk: 'high' },
  { key: 'activity.export',         category: 'Activity', label: 'Export activity',         description: 'Export activity / audit records.', risk: 'medium' },

  // ── Settings ───────────────────────────────────────────────────────────
  { key: 'settings.view',           category: 'Settings', label: 'View settings',           description: 'Open the settings area.', risk: 'low' },
  { key: 'settings.edit_workspace', category: 'Settings', label: 'Edit workspace settings', description: 'Change workspace identity and operator defaults.', risk: 'medium' },
  { key: 'settings.edit_appearance',category: 'Settings', label: 'Edit appearance',         description: 'Change theme, accent, and visual preferences.', risk: 'low' },
  { key: 'settings.edit_device',    category: 'Settings', label: 'Edit device control',     description: 'Change stream defaults and device-control policy.', risk: 'medium' },
  { key: 'settings.edit_security',  category: 'Settings', label: 'Edit security settings',  description: 'Change session, sensitive-data, and access policy.', risk: 'critical' },

  // ── Billing ────────────────────────────────────────────────────────────
  { key: 'billing.view',   category: 'Billing', label: 'View billing',   description: 'See billing and plan information.', risk: 'medium' },
  { key: 'billing.manage', category: 'Billing', label: 'Manage billing', description: 'Change plan and payment details.', risk: 'critical' },

  // ── Workspace Security ─────────────────────────────────────────────────
  { key: 'workspace.transfer_ownership', category: 'Workspace Security', label: 'Transfer ownership', description: 'Transfer workspace ownership to another member.', risk: 'critical' },
  { key: 'workspace.delete',             category: 'Workspace Security', label: 'Delete workspace',   description: 'Permanently delete the workspace.', risk: 'critical' },
] as const satisfies readonly PermissionDef[]

export type PermissionKey = (typeof PERMISSIONS)[number]['key']

/** Catalog entry with the narrow key type — what the access UI iterates over. */
export type CatalogPermission = Omit<PermissionDef, 'key'> & { key: PermissionKey }

export const PERMISSION_BY_KEY: Record<string, PermissionDef> = Object.fromEntries(
  PERMISSIONS.map((p) => [p.key, p]),
)

export const ALL_PERMISSION_KEYS: PermissionKey[] = PERMISSIONS.map((p) => p.key)

export const PERMISSION_CATEGORIES: PermissionCategory[] = [
  'Fleet', 'Phones', 'Groups', 'Account Database', 'Automations', 'Jobs',
  'Team', 'Roles & Permissions', 'Activity', 'Settings', 'Billing', 'Workspace Security',
]

/** Permissions grouped by category, in catalog order — for the access UI. */
export const PERMISSIONS_BY_CATEGORY: { category: PermissionCategory; permissions: CatalogPermission[] }[] =
  PERMISSION_CATEGORIES.map((category) => ({
    category,
    permissions: PERMISSIONS.filter((p) => p.category === category) as unknown as CatalogPermission[],
  })).filter((g) => g.permissions.length > 0)

export const RISK_META: Record<RiskLevel, { label: string; color: string }> = {
  low:      { label: 'Low',      color: 'rgba(148,163,184,0.6)' },
  medium:   { label: 'Medium',   color: 'var(--status-busy)' },
  high:     { label: 'High',     color: 'var(--status-warming)' },
  critical: { label: 'Critical', color: 'var(--status-error)' },
}

export function isCritical(key: string): boolean {
  return PERMISSION_BY_KEY[key]?.risk === 'critical'
}
