import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ROLE_TEMPLATES, type RoleId } from '@/lib/authorization/roles'
import type { PermissionKey } from '@/lib/authorization/permissions'
import type { ScopeType, AccessScope } from '@/lib/authorization/scopes'
import type { Member, OverrideEffect } from '@/lib/authorization/effective-access'
import { getActiveTeam, getAuthToken } from '@/lib/provider/auth-token'

/**
 * Team, roles, shifts, per-phone time tracking, and per-employee access.
 *
 * HONESTY NOTE / BACKEND INTEGRATION POINT
 * ----------------------------------------
 * The deployed SPA has no auth/session/employee backend, so this service owns
 * the typed contract + local persistence (zustand/persist). Roles, permission
 * overrides, and resource scopes here are the SAME shape the server would
 * persist (see lib/authorization + DEPLOY.md). Authorization is computed by the
 * shared engine in lib/authorization and enforced at the `client` seam + UI
 * guards; wire the engine into the Fastify/Prisma backend for true server
 * enforcement — the contract does not change.
 */

export type { RoleId, PermissionKey }

export interface Role {
  id: RoleId
  name: string
  description: string
  rank: number
  permissions: PermissionKey[]
  /** Owner/admin permission sets are locked. */
  locked?: boolean
}

export const DEFAULT_ROLES: Role[] = (Object.values(ROLE_TEMPLATES)).map((t) => ({
  id: t.id,
  name: t.name,
  description: t.description,
  rank: t.rank,
  permissions: [...t.permissions],
  locked: t.locked,
}))

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
  /** Phone names in the member's phone scope (for assigned_phones scope). */
  phones: string[]
  /** Resource scope type — how groups/phones constrain visibility. */
  scopeType: ScopeType
  /** Per-permission overrides layered on the role (inherit = absent). */
  overrides: Partial<Record<PermissionKey, OverrideEffect>>
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

/** Deterministic ~5-shifts-a-week history covering the last 30 days, so every
 *  Team date range (today → 30d) has honest data to aggregate. */
function seedHistory(base: number, phones: string[]): ShiftRecord[] {
  const records: ShiftRecord[] = []
  const dayStart = (off: number) => {
    const d = new Date(Date.now() - off * 24 * HOUR)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  for (let dOff = 1; dOff <= 30; dOff++) {
    if ((dOff + base) % 7 >= 5) continue // weekends off (staggered per employee)
    const start = dayStart(dOff) + (8 + ((base + dOff) % 3)) * HOUR
    const durH = 6 + ((base * 3 + dOff) % 4) // 6–9h
    const sessions = 1 + ((base + dOff) % 3)
    records.push({
      date: dayISO(dOff),
      start,
      end: start + durH * HOUR,
      breakMinutes: 20 + ((base * 5 + dOff * 3) % 26),
      sessions: Array.from({ length: sessions }, (_, i) => ({
        phoneName: phones[(base + dOff + i) % phones.length],
        start: start + i * 2 * HOUR,
        end: start + (i * 2 + 1.6) * HOUR,
        jobsPerformed: 2 + ((base + dOff + i) % 6),
        actions: 30 + ((base * 7 + dOff * 11 + i * 13) % 110),
      })),
    })
  }
  return records
}

function seedEmployees(): Employee[] {
  const now = Date.now()
  return [
    {
      id: 'emp-01', name: 'A. Rivera', email: 'a.rivera@mobfleet.io', role: 'owner',
      groups: ['Carolina', 'Instagram Farm'], phones: [], scopeType: 'workspace', overrides: {},
      createdAt: now - 220 * 24 * HOUR,
      shiftStatus: 'on-shift', shiftStart: now - 3.4 * HOUR, breakStart: null, breakMinutesToday: 18,
      currentPhone: 'CAROLINA 1', currentSessionStart: now - 0.6 * HOUR, lastActivity: now - 50_000,
      history: seedHistory(1, ['CAROLINA 1', 'CAROLINA 2', 'IG FARM 1']),
    },
    {
      id: 'emp-02', name: 'M. Chen', email: 'm.chen@mobfleet.io', role: 'manager',
      groups: ['TikTok Farm', 'Warmup Pool'], phones: [], scopeType: 'assigned_groups', overrides: {},
      createdAt: now - 160 * 24 * HOUR,
      shiftStatus: 'on-shift', shiftStart: now - 5.1 * HOUR, breakStart: null, breakMinutesToday: 32,
      currentPhone: 'TIKTOK 2', currentSessionStart: now - 1.2 * HOUR, lastActivity: now - 120_000,
      history: seedHistory(2, ['TIKTOK 1', 'TIKTOK 2', 'WARMUP 3']),
    },
    {
      id: 'emp-03', name: 'K. Novak', email: 'k.novak@mobfleet.io', role: 'operator',
      groups: ['Backup'], phones: ['BACKUP 1', 'BACKUP 2'], scopeType: 'assigned_phones', overrides: {},
      createdAt: now - 90 * 24 * HOUR,
      shiftStatus: 'on-break', shiftStart: now - 2.2 * HOUR, breakStart: now - 9 * 60_000, breakMinutesToday: 9,
      currentPhone: null, currentSessionStart: null, lastActivity: now - 9 * 60_000,
      history: seedHistory(3, ['BACKUP 1', 'BACKUP 2']),
    },
    {
      id: 'emp-04', name: 'S. Petrov', email: 's.petrov@mobfleet.io', role: 'operator',
      groups: ['Lucia', 'Warmup Pool'], phones: ['LUCIA 1', 'LUCIA 2', 'WARMUP 1'], scopeType: 'assigned_phones', overrides: {},
      createdAt: now - 45 * 24 * HOUR,
      shiftStatus: 'offline', shiftStart: null, breakStart: null, breakMinutesToday: 0,
      currentPhone: null, currentSessionStart: null, lastActivity: now - 14 * HOUR,
      history: seedHistory(4, ['LUCIA 1', 'LUCIA 2', 'WARMUP 1']),
    },
    {
      id: 'emp-05', name: 'J. Okafor', email: 'j.okafor@mobfleet.io', role: 'viewer',
      groups: [], phones: [], scopeType: 'workspace', overrides: {},
      createdAt: now - 12 * 24 * HOUR,
      shiftStatus: 'completed', shiftStart: null, breakStart: null, breakMinutesToday: 41,
      currentPhone: null, currentSessionStart: null, lastActivity: now - 1.5 * HOUR,
      history: seedHistory(5, ['IG FARM 3']),
    },
  ]
}

/** Adapt an Employee to the authorization engine's Member shape. */
export function toMember(e: Employee): Member {
  return {
    id: e.id,
    role: e.role,
    suspended: e.suspended,
    overrides: e.overrides ?? {},
    scope: { type: e.scopeType ?? 'workspace', groups: e.groups ?? [], phones: e.phones ?? [] } as AccessScope,
  }
}

// ─── Store ───────────────────────────────────────────────────────────────────

interface TeamState {
  employees: Employee[]
  roles: Role[]

  /** event: employee.created */
  addEmployee: (e: { name: string; email: string; role: RoleId; groups: string[] }) => void
  /** event: employee.updated */
  updateEmployee: (id: string, patch: Partial<Pick<Employee, 'name' | 'email' | 'role' | 'groups' | 'phones' | 'scopeType'>>) => void
  /** event: permission.override.set — null clears the override (inherit). */
  setOverride: (id: string, key: PermissionKey, effect: OverrideEffect | null) => void
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
  setRolePermissions: (roleId: RoleId, permissions: PermissionKey[]) => void
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
              phones: [],
              scopeType: role === 'owner' || role === 'admin' ? 'workspace' : role === 'operator' ? 'assigned_phones' : 'assigned_groups',
              overrides: {},
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

      setOverride: (id, key, effect) =>
        set((s) => ({
          employees: s.employees.map((e) => {
            if (e.id !== id) return e
            const overrides = { ...e.overrides }
            if (effect === null) delete overrides[key]
            else overrides[key] = effect
            return { ...e, overrides }
          }),
        })),

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
    // v3: adds resource scope + per-permission overrides per employee.
    { name: 'mobfleet-team-v3' },
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

// ─── Railway backend REST (live team membership) ─────────────────────────────
// The Railway/Fastify API for team membership. Auth: the Supabase JWT (mirrored
// from AuthContext into the provider token-seam) as a Bearer header, plus the
// active team id as x-team-id (the backend resolves the tenant from it). Base URL
// from VITE_API_URL (same env the HTTP provider uses; '' → relative dev proxy).
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

/** A team member as returned by GET /v1/team/members. Returns identity + role +
 *  permission overrides. (Suspension status is also returned but the view tracks
 *  it optimistically; per-member resource scope is not returned.) */
export interface TeamMemberDTO {
  userId: string
  role: RoleId
  createdAt: number
  email: string
  name: string | null
  isSelf: boolean
  /** Per-permission overrides: { [permissionKey]: 'allow' | 'deny' }. */
  overrides: Partial<Record<PermissionKey, OverrideEffect>>
}

export interface TeamInviteDTO {
  id: string
  email: string
  role: string
  status: string
  createdAt: number
  expiresAt: number
  /** Only returned by the backend in non-production (prod relies on email). */
  acceptUrl?: string
}

/** Patch body accepted by PATCH /v1/team/members/:userId. */
export interface MemberPatch {
  role?: RoleId
  status?: 'active' | 'suspended'
  scopeType?: ScopeType
  scopeGroups?: string[]
  scopePhones?: string[]
  /** Complete replacement map of per-permission overrides ({ key: 'allow'|'deny' }). */
  overrides?: Partial<Record<PermissionKey, OverrideEffect>>
}

async function teamApi<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken()
  const team = getActiveTeam()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (team) headers['x-team-id'] = team
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** GET /v1/team/members → identity + role per member (no status/scope). */
export const fetchTeamMembers = (): Promise<TeamMemberDTO[]> => teamApi<TeamMemberDTO[]>('/v1/team/members')

/** POST /v1/team/invites — the backend has no create-member endpoint; adding a
 *  person is an invitation (the invitee accepts a link). `name` isn't stored. */
export const inviteTeamMember = (email: string, role: RoleId): Promise<TeamInviteDTO> =>
  teamApi<TeamInviteDTO>('/v1/team/invites', { method: 'POST', body: JSON.stringify({ email, role }) })

/** DELETE /v1/team/members/:userId */
export const removeTeamMember = (userId: string): Promise<{ ok: true }> =>
  teamApi<{ ok: true }>(`/v1/team/members/${encodeURIComponent(userId)}`, { method: 'DELETE' })

/** PATCH /v1/team/members/:userId — role / status (suspend) / scope. */
export const patchTeamMember = (userId: string, patch: MemberPatch): Promise<{ ok: true }> =>
  teamApi<{ ok: true }>(`/v1/team/members/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify(patch) })
