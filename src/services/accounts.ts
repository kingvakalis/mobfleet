import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Account database — social accounts, credentials, and device assignments.
 *
 * BACKEND INTEGRATION POINT: persisted locally (zustand/persist) until the
 * server grows an `/accounts` resource; this store's shape and actions are
 * the typed contract. Reveal actions on sensitive fields are the audit hook.
 */

export type Platform = 'Instagram' | 'TikTok'
export type AccountStatus = 'active' | 'flagged' | 'banned' | 'warming'

export const ACCOUNT_STATUSES: AccountStatus[] = ['active', 'flagged', 'banned', 'warming']

/** Semantic status colors — same tokens as device statuses. */
export const ACCOUNT_STATUS_COLOR: Record<AccountStatus, string> = {
  active:  'var(--status-online)',
  flagged: 'var(--status-warming)',
  banned:  'var(--status-error)',
  warming: 'var(--status-busy)',
}

export interface Account {
  id: string
  handle: string
  platform: Platform
  username: string
  email: string
  phone: string
  assignedPhone: string | null
  group: string
  owner: string
  twoFA: boolean
  status: AccountStatus
  tags: string[]
  followers: number
  notes: string
  updatedAt: number
}

const uid = () => 'acc-' + Math.random().toString(36).slice(2, 9)
const HOUR = 3_600_000

function seed(): Account[] {
  const now = Date.now()
  const mk = (a: Omit<Account, 'id' | 'updatedAt'>, ago: number): Account => ({
    ...a, id: uid(), updatedAt: now - ago,
  })
  return [
    mk({ handle: '@carol_style',   platform: 'Instagram', username: 'carol_style',   email: 'carol@domain.com',   phone: '+1-555-0101', assignedPhone: 'CAROLINA 1',  group: 'Carolina',       owner: 'A. Rivera', twoFA: true,  status: 'active',  tags: ['growth', 'fashion'],   followers: 12400, notes: 'Main fashion account' }, 2 * 60_000),
    mk({ handle: '@tiktok_carol',  platform: 'TikTok',    username: 'tiktok_carol',  email: 'carol2@domain.com',  phone: '+1-555-0102', assignedPhone: 'CAROLINA 1',  group: 'Carolina',       owner: 'A. Rivera', twoFA: true,  status: 'active',  tags: ['growth'],              followers: 34200, notes: '' }, 5 * 60_000),
    mk({ handle: '@lucia_vibes',   platform: 'Instagram', username: 'lucia_vibes',   email: 'lucia@domain.com',   phone: '+1-555-0201', assignedPhone: 'LUCIA 1',     group: 'Lucia',          owner: 'S. Petrov', twoFA: false, status: 'warming', tags: ['warmup'],              followers: 340,   notes: 'New account warming' }, HOUR),
    mk({ handle: '@lucia_tiktok',  platform: 'TikTok',    username: 'lucia_tiktok',  email: 'lucia2@domain.com',  phone: '+1-555-0202', assignedPhone: null,          group: 'Lucia',          owner: 'S. Petrov', twoFA: false, status: 'warming', tags: ['warmup', 'tt'],        followers: 120,   notes: '' }, 3 * HOUR),
    mk({ handle: '@ig_farm_01',    platform: 'Instagram', username: 'ig_farm_01',    email: 'farm01@domain.com',  phone: '+1-555-0301', assignedPhone: 'IG FARM 1',   group: 'Instagram Farm', owner: 'M. Chen',   twoFA: true,  status: 'active',  tags: ['farm', 'ig'],          followers: 8900,  notes: '' }, 10 * 60_000),
    mk({ handle: '@ig_farm_02',    platform: 'Instagram', username: 'ig_farm_02',    email: 'farm02@domain.com',  phone: '+1-555-0302', assignedPhone: 'IG FARM 2',   group: 'Instagram Farm', owner: 'M. Chen',   twoFA: true,  status: 'flagged', tags: ['farm', 'ig'],          followers: 7200,  notes: 'Rate limit hit' }, 45 * 60_000),
    mk({ handle: '@tt_farm_01',    platform: 'TikTok',    username: 'tt_farm_01',    email: 'ttfarm1@domain.com', phone: '+1-555-0401', assignedPhone: 'TIKTOK 1',    group: 'TikTok Farm',    owner: 'K. Novak',  twoFA: false, status: 'active',  tags: ['farm', 'tt'],          followers: 21000, notes: '' }, 8 * 60_000),
    mk({ handle: '@tt_farm_02',    platform: 'TikTok',    username: 'tt_farm_02',    email: 'ttfarm2@domain.com', phone: '+1-555-0402', assignedPhone: 'TIKTOK 2',    group: 'TikTok Farm',    owner: 'K. Novak',  twoFA: false, status: 'banned',  tags: ['banned'],              followers: 0,     notes: 'Permanently banned' }, 48 * HOUR),
    mk({ handle: '@warmup_pool_1', platform: 'Instagram', username: 'warmup_pool_1', email: 'wp1@domain.com',     phone: '+1-555-0501', assignedPhone: 'WARMUP 1',    group: 'Warmup Pool',    owner: 'J. Okafor', twoFA: false, status: 'warming', tags: ['warmup'],              followers: 55,    notes: '' }, 6 * HOUR),
    mk({ handle: '@warmup_pool_2', platform: 'TikTok',    username: 'warmup_pool_2', email: 'wp2@domain.com',     phone: '+1-555-0502', assignedPhone: 'WARMUP 2',    group: 'Warmup Pool',    owner: 'J. Okafor', twoFA: false, status: 'warming', tags: ['warmup', 'tt'],        followers: 90,    notes: '' }, 4 * HOUR),
    mk({ handle: '@ig_farm_03',    platform: 'Instagram', username: 'ig_farm_03',    email: 'farm03@domain.com',  phone: '+1-555-0303', assignedPhone: null,          group: 'Instagram Farm', owner: 'M. Chen',   twoFA: true,  status: 'active',  tags: ['farm', 'ig'],          followers: 5500,  notes: '' }, 30 * 60_000),
    mk({ handle: '@tt_farm_03',    platform: 'TikTok',    username: 'tt_farm_03',    email: 'ttfarm3@domain.com', phone: '+1-555-0403', assignedPhone: 'TIKTOK 3',    group: 'TikTok Farm',    owner: 'K. Novak',  twoFA: true,  status: 'flagged', tags: ['farm', 'tt', 'check'], followers: 15800, notes: 'Needs manual check' }, HOUR),
  ]
}

export type AccountInput = Omit<Account, 'id' | 'updatedAt'>

interface AccountsState {
  accounts: Account[]
  add: (a: AccountInput) => void
  update: (id: string, patch: Partial<AccountInput>) => void
  remove: (ids: string[]) => void
  /** Bulk import; usernames already present are reported as duplicates. */
  importMany: (rows: AccountInput[]) => { added: number; duplicates: string[] }
}

export const useAccounts = create<AccountsState>()(
  persist(
    (set, get) => ({
      accounts: seed(),
      add: (a) =>
        set((s) => ({ accounts: [{ ...a, id: uid(), updatedAt: Date.now() }, ...s.accounts] })),
      update: (id, patch) =>
        set((s) => ({
          accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...patch, updatedAt: Date.now() } : a)),
        })),
      remove: (ids) =>
        set((s) => ({ accounts: s.accounts.filter((a) => !ids.includes(a.id)) })),
      importMany: (rows) => {
        const existing = new Set(get().accounts.map((a) => a.username.toLowerCase()))
        const duplicates: string[] = []
        const fresh: Account[] = []
        for (const r of rows) {
          if (existing.has(r.username.toLowerCase())) {
            duplicates.push(r.username)
            continue
          }
          existing.add(r.username.toLowerCase())
          fresh.push({ ...r, id: uid(), updatedAt: Date.now() })
        }
        set((s) => ({ accounts: [...fresh, ...s.accounts] }))
        return { added: fresh.length, duplicates }
      },
    }),
    { name: 'mobfleet-accounts-v1' },
  ),
)

export function relTime(ts: number): string {
  const d = Date.now() - ts
  if (d < 60_000) return 'just now'
  if (d < HOUR) return `${Math.floor(d / 60_000)}m ago`
  if (d < 24 * HOUR) return `${Math.floor(d / HOUR)}h ago`
  return `${Math.floor(d / (24 * HOUR))}d ago`
}

/** Parse a simple CSV: handle,platform,username,email,phone,group,owner */
export function parseAccountsCsv(text: string): AccountInput[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const rows: AccountInput[] = []
  for (const line of lines) {
    const cols = line.split(',').map((c) => c.trim())
    if (cols.length < 3) continue
    if (/^handle/i.test(cols[0])) continue // header row
    const platform: Platform = /tiktok/i.test(cols[1] ?? '') ? 'TikTok' : 'Instagram'
    rows.push({
      handle: cols[0].startsWith('@') ? cols[0] : '@' + cols[0],
      platform,
      username: cols[2] ?? cols[0].replace(/^@/, ''),
      email: cols[3] ?? '',
      phone: cols[4] ?? '',
      assignedPhone: null,
      group: cols[5] ?? 'Unassigned',
      owner: cols[6] ?? 'Unassigned',
      twoFA: false,
      status: 'warming',
      tags: ['imported'],
      followers: 0,
      notes: '',
    })
  }
  return rows
}
