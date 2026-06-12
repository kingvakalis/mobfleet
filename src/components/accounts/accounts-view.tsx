import { useState } from 'react'
import {
  Plus, Upload, Download, Search, Eye, EyeOff, Copy,
  ChevronDown, X, Smartphone, Edit, Archive, Play,
  ShieldCheck, ShieldOff,
} from 'lucide-react'

type Platform = 'Instagram' | 'TikTok'
type AccStatus = 'active' | 'flagged' | 'banned' | 'warming'

interface Account {
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
  status: AccStatus
  tags: string[]
  lastUpdated: string
  followers: number
  notes: string
}

const MOCK_ACCOUNTS: Account[] = [
  { id: 'a-01', handle: '@carol_style',    platform: 'Instagram', username: 'carol_style',    email: 'carol@domain.com',    phone: '+1-555-0101', assignedPhone: 'iPhone-003', group: 'Carolina',      owner: 'carolina', twoFA: true,  status: 'active',  tags: ['growth', 'fashion'],  lastUpdated: '2m ago',  followers: 12400, notes: 'Main fashion account' },
  { id: 'a-02', handle: '@tiktok_carol',   platform: 'TikTok',    username: 'tiktok_carol',   email: 'carol2@domain.com',   phone: '+1-555-0102', assignedPhone: 'iPhone-003', group: 'Carolina',      owner: 'carolina', twoFA: true,  status: 'active',  tags: ['growth'],             lastUpdated: '5m ago',  followers: 34200, notes: '' },
  { id: 'a-03', handle: '@lucia_vibes',    platform: 'Instagram', username: 'lucia_vibes',    email: 'lucia@domain.com',    phone: '+1-555-0201', assignedPhone: 'iPhone-010', group: 'Lucia',         owner: 'lucia',    twoFA: false, status: 'warming', tags: ['warmup'],             lastUpdated: '1h ago',  followers: 340,   notes: 'New account warming' },
  { id: 'a-04', handle: '@lucia_tiktok',   platform: 'TikTok',    username: 'lucia_tiktok',   email: 'lucia2@domain.com',   phone: '+1-555-0202', assignedPhone: null,         group: 'Lucia',         owner: 'lucia',    twoFA: false, status: 'warming', tags: ['warmup', 'tt'],       lastUpdated: '3h ago',  followers: 120,   notes: '' },
  { id: 'a-05', handle: '@ig_farm_01',     platform: 'Instagram', username: 'ig_farm_01',     email: 'farm01@domain.com',   phone: '+1-555-0301', assignedPhone: 'iPhone-015', group: 'Instagram Farm', owner: 'dimitris', twoFA: true,  status: 'active',  tags: ['farm', 'ig'],         lastUpdated: '10m ago', followers: 8900,  notes: '' },
  { id: 'a-06', handle: '@ig_farm_02',     platform: 'Instagram', username: 'ig_farm_02',     email: 'farm02@domain.com',   phone: '+1-555-0302', assignedPhone: 'iPhone-016', group: 'Instagram Farm', owner: 'dimitris', twoFA: true,  status: 'flagged', tags: ['farm', 'ig'],         lastUpdated: '45m ago', followers: 7200,  notes: 'Rate limit hit' },
  { id: 'a-07', handle: '@tt_farm_01',     platform: 'TikTok',    username: 'tt_farm_01',     email: 'ttfarm1@domain.com',  phone: '+1-555-0401', assignedPhone: 'iPhone-020', group: 'TikTok Farm',   owner: 'amber',    twoFA: false, status: 'active',  tags: ['farm', 'tt'],         lastUpdated: '8m ago',  followers: 21000, notes: '' },
  { id: 'a-08', handle: '@tt_farm_02',     platform: 'TikTok',    username: 'tt_farm_02',     email: 'ttfarm2@domain.com',  phone: '+1-555-0402', assignedPhone: 'iPhone-021', group: 'TikTok Farm',   owner: 'amber',    twoFA: false, status: 'banned',  tags: ['banned'],             lastUpdated: '2d ago',  followers: 0,     notes: 'Permanently banned' },
  { id: 'a-09', handle: '@warmup_pool_1',  platform: 'Instagram', username: 'warmup_pool_1',  email: 'wp1@domain.com',      phone: '+1-555-0501', assignedPhone: 'iPhone-025', group: 'Warmup Pool',   owner: 'polina',   twoFA: false, status: 'warming', tags: ['warmup'],             lastUpdated: '6h ago',  followers: 55,    notes: '' },
  { id: 'a-10', handle: '@warmup_pool_2',  platform: 'TikTok',    username: 'warmup_pool_2',  email: 'wp2@domain.com',      phone: '+1-555-0502', assignedPhone: 'iPhone-026', group: 'Warmup Pool',   owner: 'polina',   twoFA: false, status: 'warming', tags: ['warmup', 'tt'],       lastUpdated: '4h ago',  followers: 90,    notes: '' },
  { id: 'a-11', handle: '@ig_farm_03',     platform: 'Instagram', username: 'ig_farm_03',     email: 'farm03@domain.com',   phone: '+1-555-0303', assignedPhone: null,         group: 'Instagram Farm', owner: 'dimitris', twoFA: true,  status: 'active',  tags: ['farm', 'ig'],         lastUpdated: '30m ago', followers: 5500,  notes: '' },
  { id: 'a-12', handle: '@tt_farm_03',     platform: 'TikTok',    username: 'tt_farm_03',     email: 'ttfarm3@domain.com',  phone: '+1-555-0403', assignedPhone: 'iPhone-022', group: 'TikTok Farm',   owner: 'amber',    twoFA: true,  status: 'flagged', tags: ['farm', 'tt', 'check'], lastUpdated: '1h ago',  followers: 15800, notes: 'Needs manual check' },
]

const STATUS_STYLE: Record<AccStatus, string> = {
  active:  'bg-emerald-400/10 text-emerald-400',
  flagged: 'bg-yellow-400/10 text-yellow-400',
  banned:  'bg-red-400/10 text-red-400',
  warming: 'bg-indigo-400/10 text-indigo-400',
}

const PLATFORM_COLOR: Record<Platform, string> = {
  Instagram: '#e1306c',
  TikTok:    '#010101',
}

const PLATFORM_EMOJI: Record<Platform, string> = {
  Instagram: '📷',
  TikTok:    '🎵',
}

function mask(_s: string) {
  return '••••••'
}

interface RevealCellProps {
  value: string
}
function RevealCell({ value }: RevealCellProps) {
  const [shown, setShown] = useState(false)
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(value).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="flex items-center gap-1.5 group/cell">
      <span className="font-mono text-[11px] text-white/50">{shown ? value : mask(value)}</span>
      <button
        onClick={() => setShown(v => !v)}
        className="opacity-0 group-hover/cell:opacity-100 p-0.5 rounded text-white/25 hover:text-white/60 transition-all"
      >
        {shown ? <EyeOff size={11} /> : <Eye size={11} />}
      </button>
      <button
        onClick={handleCopy}
        className="opacity-0 group-hover/cell:opacity-100 p-0.5 rounded text-white/25 hover:text-white/60 transition-all"
      >
        <Copy size={11} className={copied ? 'text-emerald-400' : ''} />
      </button>
    </div>
  )
}

export function AccountsView() {
  const [search, setSearch]         = useState('')
  const [platFilter, setPlatFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  const [groupFilter, setGroupFilter]   = useState('All')
  const [ownerFilter, setOwnerFilter]   = useState('All')
  const [fa2Filter, setFa2Filter]       = useState('All')
  const [drawerAcc, setDrawerAcc]       = useState<Account | null>(null)

  const groups  = ['All', ...Array.from(new Set(MOCK_ACCOUNTS.map(a => a.group)))]
  const owners  = ['All', ...Array.from(new Set(MOCK_ACCOUNTS.map(a => a.owner)))]

  const visible = MOCK_ACCOUNTS.filter(a => {
    if (platFilter !== 'All' && a.platform !== platFilter) return false
    if (statusFilter !== 'All' && a.status !== statusFilter) return false
    if (groupFilter !== 'All' && a.group !== groupFilter) return false
    if (ownerFilter !== 'All' && a.owner !== ownerFilter) return false
    if (fa2Filter === 'Yes' && !a.twoFA) return false
    if (fa2Filter === 'No' && a.twoFA) return false
    if (search !== '') {
      const q = search.toLowerCase()
      return (
        a.username.includes(q) ||
        a.handle.includes(q) ||
        a.email.toLowerCase().includes(q) ||
        a.phone.includes(q) ||
        (a.assignedPhone ?? '').toLowerCase().includes(q)
      )
    }
    return true
  })

  const total      = MOCK_ACCOUNTS.length
  const instagram  = MOCK_ACCOUNTS.filter(a => a.platform === 'Instagram').length
  const tiktok     = MOCK_ACCOUNTS.filter(a => a.platform === 'TikTok').length
  const emailCount = MOCK_ACCOUNTS.filter(a => a.email !== '').length
  const noRecovery = MOCK_ACCOUNTS.filter(a => !a.twoFA).length
  const issues     = MOCK_ACCOUNTS.filter(a => a.status === 'flagged' || a.status === 'banned').length
  const assigned   = MOCK_ACCOUNTS.filter(a => a.assignedPhone !== null).length
  const unassigned = MOCK_ACCOUNTS.filter(a => a.assignedPhone === null).length

  return (
    <div className="flex h-full relative overflow-hidden">
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/30 mb-0.5">Data Vault</p>
            <h1 className="text-lg font-semibold text-white/90">Account Database</h1>
            <p className="text-xs text-white/30 mt-0.5">Manage social accounts, credentials, and device assignments</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-xs text-white/55 hover:text-white/80 border border-white/[0.05] transition-colors">
              <Download size={13} /> Export
            </button>
            <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-xs text-white/55 hover:text-white/80 border border-white/[0.05] transition-colors">
              <Upload size={13} /> Import CSV
            </button>
            <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors">
              <Plus size={15} /> Add Account
            </button>
          </div>
        </div>

        {/* KPI row */}
        <div className="flex gap-2 px-6 py-3 border-b border-white/[0.04] overflow-x-auto">
          {[
            { label: 'Total Accounts',    value: total,      color: 'text-white/80' },
            { label: 'Instagram',         value: instagram,  color: 'text-pink-400' },
            { label: 'TikTok',            value: tiktok,     color: 'text-white/60' },
            { label: 'Emails Stored',     value: emailCount, color: 'text-indigo-400' },
            { label: 'Missing Recovery',  value: noRecovery, color: 'text-yellow-400' },
            { label: 'Issues',            value: issues,     color: 'text-red-400' },
            { label: 'Assigned',          value: assigned,   color: 'text-emerald-400' },
            { label: 'Unassigned',        value: unassigned, color: 'text-white/30' },
          ].map(k => (
            <div key={k.label} className="flex flex-col px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.05] shrink-0">
              <span className="text-[9px] text-white/25 uppercase tracking-wider whitespace-nowrap">{k.label}</span>
              <span className={['text-lg font-semibold mt-0.5', k.color].join(' ')}>{k.value}</span>
            </div>
          ))}
        </div>

        {/* Search + filters */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-white/[0.04] flex-wrap">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search username, email, phone, assigned iPhone..."
              className="h-8 pl-8 pr-3 rounded-lg bg-white/[0.04] border border-white/[0.06] text-xs text-white/80 placeholder-white/25 outline-none focus:border-white/20 w-72"
            />
          </div>

          {[
            { label: 'Platform', value: platFilter,   setter: setPlatFilter,   opts: ['All', 'Instagram', 'TikTok'] },
            { label: 'Status',   value: statusFilter, setter: setStatusFilter, opts: ['All', 'active', 'flagged', 'banned', 'warming'] },
            { label: 'Group',    value: groupFilter,  setter: setGroupFilter,  opts: groups },
            { label: 'Owner',    value: ownerFilter,  setter: setOwnerFilter,  opts: owners },
            { label: 'Has 2FA',  value: fa2Filter,    setter: setFa2Filter,    opts: ['All', 'Yes', 'No'] },
          ].map(f => (
            <div key={f.label} className="relative flex items-center">
              <select
                value={f.value}
                onChange={e => f.setter(e.target.value)}
                className="h-8 pl-3 pr-7 rounded-lg bg-white/[0.04] border border-white/[0.06] text-xs text-white/60 outline-none focus:border-white/20 cursor-pointer appearance-none"
              >
                {f.opts.map(o => <option key={o} value={o}>{f.label === 'All' ? o : (f.value === 'All' ? f.label + ': All' : o)}</option>)}
              </select>
              <ChevronDown size={11} className="absolute right-2 text-white/25 pointer-events-none" />
            </div>
          ))}

          <span className="ml-auto text-xs text-white/25">{visible.length} accounts</span>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs min-w-[1100px]">
            <thead className="sticky top-0 bg-[#0a0a0f] z-10">
              <tr className="text-white/20 text-[9px] uppercase tracking-wider border-b border-white/[0.04]">
                <th className="text-left px-4 py-2 font-medium">Account</th>
                <th className="text-left px-3 py-2 font-medium">Platform</th>
                <th className="text-left px-3 py-2 font-medium">Username</th>
                <th className="text-left px-3 py-2 font-medium">Email</th>
                <th className="text-left px-3 py-2 font-medium">Phone</th>
                <th className="text-left px-3 py-2 font-medium">Assigned iPhone</th>
                <th className="text-left px-3 py-2 font-medium">Group</th>
                <th className="text-left px-3 py-2 font-medium">Owner</th>
                <th className="text-center px-3 py-2 font-medium">2FA</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Tags</th>
                <th className="text-left px-3 py-2 font-medium">Updated</th>
                <th className="text-right px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.025]">
              {visible.map(a => (
                <tr
                  key={a.id}
                  className="hover:bg-white/[0.02] transition-colors group cursor-pointer"
                  onClick={() => setDrawerAcc(a)}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0"
                        style={{ background: PLATFORM_COLOR[a.platform] + '33' }}
                      >
                        {PLATFORM_EMOJI[a.platform]}
                      </div>
                      <span className="text-white/75 font-medium">{a.handle}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-white/40">{a.platform}</td>
                  <td className="px-3 py-2.5 font-mono text-white/55">{a.username}</td>
                  <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                    <RevealCell value={a.email} />
                  </td>
                  <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                    <RevealCell value={a.phone} />
                  </td>
                  <td className="px-3 py-2.5">
                    {a.assignedPhone
                      ? <span className="text-white/55">{a.assignedPhone}</span>
                      : <span className="text-white/20">—</span>
                    }
                  </td>
                  <td className="px-3 py-2.5 text-white/40">{a.group}</td>
                  <td className="px-3 py-2.5 text-white/40">{a.owner}</td>
                  <td className="px-3 py-2.5 text-center">
                    {a.twoFA
                      ? <ShieldCheck size={13} className="text-emerald-400 mx-auto" />
                      : <ShieldOff size={13} className="text-white/20 mx-auto" />
                    }
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={['text-[10px] px-2 py-0.5 rounded-full font-medium', STATUS_STYLE[a.status]].join(' ')}>
                      {a.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {a.tags.slice(0, 2).map(t => (
                        <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400/60">{t}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-white/25">{a.lastUpdated}</td>
                  <td className="px-4 py-2.5 text-right" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button className="p-1.5 rounded hover:bg-white/[0.06] text-white/25 hover:text-white/70 transition-colors" title="Edit">
                        <Edit size={12} />
                      </button>
                      <button className="p-1.5 rounded hover:bg-indigo-500/10 text-white/25 hover:text-indigo-400 transition-colors" title="Assign Phone">
                        <Smartphone size={12} />
                      </button>
                      <button className="p-1.5 rounded hover:bg-white/[0.06] text-white/25 hover:text-white/50 transition-colors" title="Archive">
                        <Archive size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Right-side Drawer */}
      {drawerAcc && (
        <div className="w-[320px] shrink-0 border-l border-white/[0.06] bg-[#0a0a0f] flex flex-col overflow-y-auto">
          {/* Drawer header */}
          <div className="flex items-center justify-between px-4 py-4 border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-base"
                style={{ background: PLATFORM_COLOR[drawerAcc.platform] + '33' }}
              >
                {PLATFORM_EMOJI[drawerAcc.platform]}
              </div>
              <div>
                <div className="text-sm font-semibold text-white/90">{drawerAcc.handle}</div>
                <div className="text-[10px] text-white/30">{drawerAcc.platform}</div>
              </div>
            </div>
            <button
              onClick={() => setDrawerAcc(null)}
              className="p-1.5 rounded-lg hover:bg-white/[0.06] text-white/30 hover:text-white/70 transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          {/* Account Summary */}
          <div className="px-4 py-3 border-b border-white/[0.05]">
            <h3 className="text-[10px] uppercase tracking-widest text-white/25 mb-2">Account Summary</h3>
            <div className="flex items-center gap-2 mb-2">
              <span className={['text-[10px] px-2 py-0.5 rounded-full font-medium', STATUS_STYLE[drawerAcc.status]].join(' ')}>
                {drawerAcc.status}
              </span>
              {drawerAcc.twoFA && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-400/10 text-emerald-400 flex items-center gap-1">
                  <ShieldCheck size={9} />2FA
                </span>
              )}
            </div>
            <div className="text-2xl font-bold text-white/80 mb-0.5">
              {drawerAcc.followers.toLocaleString()}
            </div>
            <div className="text-[10px] text-white/25">followers</div>
          </div>

          {/* Login Data */}
          <div className="px-4 py-3 border-b border-white/[0.05]">
            <h3 className="text-[10px] uppercase tracking-widest text-white/25 mb-2">Login Data</h3>
            <div className="flex flex-col gap-2">
              {[
                { label: 'Username', value: drawerAcc.username, sensitive: false },
                { label: 'Email',    value: drawerAcc.email,    sensitive: true  },
                { label: 'Phone',    value: drawerAcc.phone,    sensitive: true  },
                { label: 'Owner',    value: drawerAcc.owner,    sensitive: false },
              ].map(row => (
                <div key={row.label} className="flex justify-between items-center">
                  <span className="text-[10px] text-white/25">{row.label}</span>
                  {row.sensitive
                    ? <RevealCell value={row.value} />
                    : <span className="font-mono text-[11px] text-white/55">{row.value}</span>
                  }
                </div>
              ))}
            </div>
          </div>

          {/* Operational Assignment */}
          <div className="px-4 py-3 border-b border-white/[0.05]">
            <h3 className="text-[10px] uppercase tracking-widest text-white/25 mb-2">Operational Assignment</h3>
            <div className="flex flex-col gap-2 text-[11px]">
              <div className="flex justify-between">
                <span className="text-white/25">iPhone</span>
                <span className="text-white/60">{drawerAcc.assignedPhone ?? 'Unassigned'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/25">Group</span>
                <span className="text-white/60">{drawerAcc.group}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/25">Last Updated</span>
                <span className="text-white/40">{drawerAcc.lastUpdated}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="px-4 py-3 border-b border-white/[0.05]">
            <h3 className="text-[10px] uppercase tracking-widest text-white/25 mb-2">Notes</h3>
            <textarea
              defaultValue={drawerAcc.notes}
              rows={3}
              placeholder="Add notes..."
              className="w-full bg-white/[0.03] border border-white/[0.05] rounded-lg p-2 text-xs text-white/55 placeholder-white/20 outline-none focus:border-white/20 resize-none"
            />
          </div>

          {/* Quick Actions */}
          <div className="px-4 py-3">
            <h3 className="text-[10px] uppercase tracking-widest text-white/25 mb-2">Quick Actions</h3>
            <div className="flex flex-col gap-1.5">
              <button className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-xs text-indigo-400 transition-colors">
                <Play size={12} /> Launch Phone
              </button>
              <button className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.07] text-xs text-white/55 hover:text-white/80 transition-colors">
                <Copy size={12} /> Copy Username
              </button>
              <button className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.07] text-xs text-white/55 hover:text-white/80 transition-colors">
                <Copy size={12} /> Copy Email
              </button>
              <button className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.07] text-xs text-white/55 hover:text-white/80 transition-colors">
                <Edit size={12} /> Edit Account
              </button>
              <button className={[
                'flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors',
                drawerAcc.status === 'active'
                  ? 'bg-yellow-400/10 hover:bg-yellow-400/20 text-yellow-400'
                  : 'bg-emerald-400/10 hover:bg-emerald-400/20 text-emerald-400',
              ].join(' ')}>
                <ShieldCheck size={12} /> Change Status
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
