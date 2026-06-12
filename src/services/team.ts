import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Team, roles, shifts, and per-phone time tracking.
 *
 * HONESTY NOTE / BACKEND INTEGRATION POINT
 * ----------------------------------------
 * The current backend has no employee/session resources, so this service owns
 * a typed contract + local persistence (zustand/persist). Shift and session
 * records here are controlled development data: real events the UI *would*
 * receive — `shift.started`, `shift.ended`, `break.started`, `break.ended`,
 * `phone.session.started`, `phone.session.ended` — are documented on each
 * action below. Wire those actions to the server and the UI is unchanged.
 *
 * "Time on a phone" = an explicit control session (operator opened control),
 * ended on exit / shift end. It is NOT merely having a tab open.
 */

export type RoleId = 'owner' | 'admin' | 'manager' | 'operator' | 'viewer'

export type PermissionId =
  | 'phones.view' | 'phones.control' | 'phones.reboot' | 'phones.assign'
  | 'automations.run' | 'automations.edit'
  | 'accounts.view' | 'accounts.reveal'
  | 'groups.manage' | 'team.manage' | 'reports.view' | 'settings.manage'

export const PERMISSION_GROUPS: { group: string; permissions: { id: PermissionId; label: string }[] }[] = [
  {
    group: 'Phones',
    permissions: [
      { id: 'phones.view',    label: 'View phones' },
      { id: 'phones.control', label: 'Control phones' },
      { id: 'phones.reboot',  label: 'Reboot phones' },
      { id: 'phones.assign',  label: 'Assign phones' },
    ],
  },
  {
    group: 'Automations',
    permissions: [
      { id: 'automations.run',  label: 'Run automations' },
      { id: 'automations.edit', label: 'Edit automations' },
    ],
  },
  {
    group: 'Accounts',
    permissions: [
      { id: 'accounts.view',   label: 'View account database' },
      { id: 'accounts.reveal', label: 'Reveal protected data' },
    ],
  },
  {
    group: 'Administration',
    permissions: [
      { id: 'groups.manage',   label: 'Manage groups' },
      { id: 'team.manage',     label: 'Manage employees' },
      { id: 'reports.view',    label: 'View reports' },
      { id: 'settings.manage', label: 'Change settings' },
    ],
  },
]

const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap(g => g.permissions.map(p => p.id))

export interface Role {
  id: RoleId
  name: string
  permissions: PermissionId[]
  /** Owner/admin roles cannot be edited or removed from the UI. */
  locked?: boolean
}

export const DEFAULT_ROLES: Role[] = [
  { id: 'owner',    name: 'Owner',    permissions: [...ALL_PERMISSIONS], locked: true },
  { id: 'admin',    name: 'Admin',    permissions: [...ALL_PERMISSIONS], locked: true },
  { id: 'manager',  name: 'Manager',  permissions: ['phones.view', 'phones.control', 'phones.reboot', 'phones.assign', 'automations.run', 'automations.edit', 'accounts.view', 'groups.manage', 'reports.view'] },
  { id: 'operator', name: 'Operator', permissions: ['phones.view', 'phones.control', 'automations.run', 'accounts.view'] },
  { id: 'viewer',   name: 'Viewer',   permissions: ['phones.view', 'reports.view'] },
]

export type ShiftStatus = 'on-shift' | 'on-break' | 'offline' | 'completed'

export interface PhoneSession {
  phoneName: string
  /** epoch ms */
  start: number
  /** epoch ms — null = session ongoing */
  end: number | null
  jobsPerformed: number
  actions: number
}

export interface ShiftRecord {
  /** ISO date */
  date: string
  start: number
  end: number | null
  breakMinutes: number
  sessions: PhoneSession[]
}

export interface Employee {
  id: string
  name: string
  email: string
  role: RoleId
  groups: string[]
  createdAt: number
  suspended?: boolean
  shiftStatus: ShiftStatus
  /** epoch ms of current shift start (when on shift / on break). */
  shiftStart: number | null
  breakStart: number | null
  breakMinutesToday: number
  currentPhone: string | null
  currentSessionStart: number | null
  lastActivity: number
  history: ShiftRecord[]
}

// ─── Development seed data ───────────────────────────────────────────────────
// Deterministic, clearly synthetic. Replaced wholesale once the backend exists.

const HOUR = 3_600_000
const dayISO = (offset: number) => {
  const d = new Date(Date.now() - offset * 24 * HOUR)
  return d.toISOString().slice(0, 10)
}

function seedHistory(base: number, phones: string[]): ShiftRecord[] {
  return [1, 2, 3].map((dOff) => {
    const start = Date.now() - dOff * 24 * HOUR - 8 * HOUR
    return {
      date: dayISO(dOff),
      start,
      end: start + (7 + (base % 3)) * HOUR,
      breakMinutes: 25 + (base % 20),
      sessions: phones.slice(0, 2 + (base % 2)).map((p, i) => ({
        phoneName: p,
        start: start + i * 2 * HOUR,
        end: start + (i * 2 + 1.6) * HOUR,
        jobsPerformed: 3 + ((base + i) % 5),
        actions: 40 + ((base * 7 + i * 13) % 90),
      })),
    }
  })
}

function seedEmployees(): Employee[] {
  const now = Date.now()
  return [
    {
      id: 'emp-01', name: 'A. Rivera', email: 'a.rivera@mobfleet.io', role: 'owner',
      groups: ['Carolina', 'Instagram Farm'], createdAt: now - 220 * 24 * HOUR,
      shiftStatus: 'on-shift', shiftStart: now - 3.4 * HOUR, breakStart: null, breakMinutesToday: 18,
      currentPhone: 'CAROLINA 1', currentSessionStart: now - 0.6 * HOUR, lastActivity: now - 50_000,
      history: seedHistory(1, ['CAROLINA 1', 'CAROLINA 2', 'IG FARM 1']),
    },
    {
      id: 'emp-02', name: 'M. Chen', email: 'm.chen@mobfleet.io', role: 'manager',
      groups: ['TikTok Farm', 'Warmup Pool'], createdAt: now - 160 * 24 * HOUR,
      shiftStatus: 'on-shift', shiftStart: now - 5.1 * HOUR, breakStart: null, breakMinutesToday: 32,
      currentPhone: 'TIKTOK 2', currentSessionStart: now - 1.2 * HOUR, lastActivity: now - 120_000,
      history: seedHistory(2, ['TIKTOK 1', 'TIKTOK 2', 'WARMUP 3']),
    },
    {
      id: 'emp-03', name: 'K. Novak', email: 'k.novak@mobfleet.io', role: 'operator',
      groups: ['Backup'], createdAt: now - 90 * 24 * HOUR,
      shiftStatus: 'on-break', shiftStart: now - 2.2 * HOUR, breakStart: now - 9 * 60_000, breakMinutesToday: 9,
      currentPhone: null, currentSessionStart: null, lastActivity: now - 9 * 60_000,
      history: seedHistory(3, ['BACKUP 1', 'BACKUP 2']),
    },
    {
      id: 'emp-04', name: 'S. Petrov', email: 's.petrov@mobfleet.io', role: 'operator',
      groups: ['Lucia', 'Warmup Pool'], createdAt: now - 45 * 24 * HOUR,
      shiftStatus: 'offline', shiftStart: null, breakStart: null, breakMinutesToday: 0,
      currentPhone: null, currentSessionStart: null, lastActivity: now - 14 * HOUR,
      history: seedHistory(4, ['LUCIA 1', 'LUCIA 2', 'WARMUP 1']),
    },
    {
      id: 'emp-05', name: 'J. Okafor', email: 'j.okafor@mobfleet.io', role: 'viewer',
      groups: [], createdAt: now - 12 * 24 * HOUR,
      shiftStatus: 'completed', shiftStart: null, breakStart: null, breakMinutesToday: 41,
      currentPhone: null, currentSessionStart: null, lastActivity: now - 1.5 * HOUR,
      history: seedHistory(5, ['IG FARM 3']),
    },
  ]
}

// ─── Store ───────────────────────────────────────────────────────────────────

interface TeamState {
  employees: Employee[]
  roles: Role[]

  /** event: employee.created */
  addEmployee: (e: { name: string; email: string; role: RoleId; groups: string[] }) => void
  /** event: employee.updated */
  updateEmployee: (id: string, patch: Partial<Pick<Employee, 'name' | 'email' | 'role' | 'groups'>>) => void
  /** event: employee.suspended / employee.reinstated */
  setSuspended: (id: string, suspended: boolean) => void
  /** event: employee.removed */
  removeEmployee: (id: string) => void
  /** event: shift.started */
  startShift: (id: string) => void
  /** event: shift.ended — folds the live shift into history */
  endShift: (id: string) => void
  /** events: break.started / break.ended */
  toggleBreak: (id: string) => void
  /** event: role.permissions.updated */
  setRolePermissions: (roleId: RoleId, permissions: PermissionId[]) => void
}

export const useTeam = create<TeamState>()(
  persist(
    (set) => ({
      employees: seedEmployees(),
      roles: DEFAULT_ROLES,

      addEmployee: ({ name, email, role, groups }) =>
        set((s) => ({
          employees: [
            ...s.employees,
            {
              id: 'emp-' + Math.random().toString(36).slice(2, 8),
              name, email, role, groups,
              createdAt: Date.now(),
              shiftStatus: 'offline' as const,
              shiftStart: null, breakStart: null, breakMinutesToday: 0,
              currentPhone: null, currentSessionStart: null,
              lastActivity: Date.now(),
              history: [],
            },
          ],
        })),

      updateEmployee: (id, patch) =>
        set((s) => ({ employees: s.employees.map((e) => (e.id === id ? { ...e, ...patch } : e)) })),

      setSuspended: (id, suspended) =>
        set((s) => ({ employees: s.employees.map((e) => (e.id === id ? { ...e, suspended } : e)) })),

      removeEmployee: (id) =>
        set((s) => ({ employees: s.employees.filter((e) => e.id !== id) })),

      startShift: (id) =>
        set((s) => ({
          employees: s.employees.map((e) =>
            e.id === id
              ? { ...e, shiftStatus: 'on-shift', shiftStart: Date.now(), breakMinutesToday: 0, lastActivity: Date.now() }
              : e,
          ),
        })),

      endShift: (id) =>
        set((s) => ({
          employees: s.employees.map((e) => {
            if (e.id !== id || !e.shiftStart) return e
            const record: ShiftRecord = {
              date: new Date().toISOString().slice(0, 10),
              start: e.shiftStart,
              end: Date.now(),
              breakMinutes: e.breakMinutesToday,
              sessions: e.currentPhone && e.currentSessionStart
                ? [{ phoneName: e.currentPhone, start: e.currentSessionStart, end: Date.now(), jobsPerformed: 0, actions: 0 }]
                : [],
            }
            return {
              ...e,
              shiftStatus: 'completed',
              shiftStart: null,
              breakStart: null,
              currentPhone: null,
              currentSessionStart: null,
              lastActivity: Date.now(),
              history: [record, ...e.history],
            }
          }),
        })),

      toggleBreak: (id) =>
        set((s) => ({
          employees: s.employees.map((e) => {
            if (e.id !== id) return e
            if (e.shiftStatus === 'on-break' && e.breakStart) {
              const mins = Math.round((Date.now() - e.breakStart) / 60_000)
              return { ...e, shiftStatus: 'on-shift', breakStart: null, breakMinutesToday: e.breakMinutesToday + mins, lastActivity: Date.now() }
            }
            if (e.shiftStatus === 'on-shift') {
              return { ...e, shiftStatus: 'on-break', breakStart: Date.now(), lastActivity: Date.now() }
            }
            return e
          }),
        })),

      setRolePermissions: (roleId, permissions) =>
        set((s) => ({
          roles: s.roles.map((r) => (r.id === roleId && !r.locked ? { ...r, permissions } : r)),
        })),
    }),
    { name: 'mobfleet-team-v1' },
  ),
)

// ─── Derived helpers ─────────────────────────────────────────────────────────

export function shiftDurationMs(e: Employee): number {
  return e.shiftStart ? Date.now() - e.shiftStart : 0
}

export function activeMs(e: Employee): number {
  const total = shiftDurationMs(e)
  const breaks = e.breakMinutesToday * 60_000 + (e.breakStart ? Date.now() - e.breakStart : 0)
  return Math.max(0, total - breaks)
}

export function fmtDur(ms: number): string {
  if (ms <= 0) return '—'
  const h = Math.floor(ms / HOUR)
  const m = Math.floor((ms % HOUR) / 60_000)
  return `${h}h ${String(m).padStart(2, '0')}m`
}

export function currentSessionMs(e: Employee): number {
  return e.currentSessionStart ? Date.now() - e.currentSessionStart : 0
}

export function phonesUsedToday(e: Employee): number {
  const today = new Date().toISOString().slice(0, 10)
  const past = e.history.find((h) => h.date === today)?.sessions.length ?? 0
  return past + (e.currentPhone ? 1 : 0)
}
