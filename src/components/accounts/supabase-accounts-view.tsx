import { useMemo, useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus, Trash2, Pencil, X, Upload, Download, Search } from 'lucide-react'
import { EXPO_OUT, fadeRise, staggerContainer } from '@/lib/motion'
import { useTeamContext } from '@/contexts/TeamContext'
import { useDevices } from '@/hooks/useDevices'
import { useAccountRecords, type NewAccount } from '@/hooks/useAccountRecords'
import { useActingEmployee } from '@/lib/authorization/use-access'
import { can } from '@/lib/authorization'
import { useToastStore } from '@/state/toast-store'
import type { AccountRecordRow, AccountRecordStatus } from '@/lib/database.types'

/**
 * Account Database — SUPABASE-MODE, METADATA ONLY. This view never reads or writes a password,
 * recovery code, phone, cookie, token, 2FA seed, or session — those columns do not exist on
 * account_records by design, and there is NO reveal/copy-secret control anywhere here. Backed
 * by real Supabase RLS (account_records); no localStorage, no fake seed data, no Railway.
 */

const PLATFORMS = ['Instagram', 'TikTok'] as const
const STATUSES: AccountRecordStatus[] = ['active', 'flagged', 'banned', 'warming']
const STATUS_COLOR: Record<AccountRecordStatus, string> = {
  active: 'var(--status-online)', flagged: 'var(--status-warming)', banned: 'var(--status-error)', warming: 'var(--status-busy)',
}

function StatusPill({ status }: { status: AccountRecordStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wider"
      style={{ color: STATUS_COLOR[status], background: `color-mix(in srgb, ${STATUS_COLOR[status]} 12%, transparent)` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[status] }} />{status}
    </span>
  )
}

// Metadata-only CSV — NO password/recovery/secret columns.
const CSV_HEADER = 'handle,platform,username,email,status,group,followers,two_fa,tags,notes'
function toCsv(rows: AccountRecordRow[]): string {
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`
  const lines = rows.map((a) => [a.handle, a.platform, a.username, a.email, a.status, a.group_name, String(a.followers), String(a.two_fa), a.tags.join('|'), a.notes].map(esc).join(','))
  return [CSV_HEADER, ...lines].join('\n')
}
function parseCsv(text: string): NewAccount[] {
  const out: NewAccount[] = []
  for (const raw of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const cols = raw.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
    if (/^handle/i.test(cols[0])) continue
    if (!cols[0]) continue
    const platform = /tiktok/i.test(cols[1] ?? '') ? 'TikTok' : 'Instagram'
    const status = (STATUSES as string[]).includes((cols[4] ?? '').toLowerCase()) ? (cols[4].toLowerCase() as AccountRecordStatus) : 'warming'
    out.push({
      handle: cols[0].startsWith('@') ? cols[0] : '@' + cols[0],
      platform,
      username: cols[2] ?? '',
      email: cols[3] ?? '',
      status,
      group_name: cols[5] || 'Unassigned',
      followers: Number(cols[6]) || 0,
      two_fa: /^(true|yes|1)$/i.test(cols[7] ?? ''),
      tags: (cols[8] ?? '').split('|').map((t) => t.trim()).filter(Boolean),
      notes: cols[9] ?? '',
    })
  }
  return out
}

function AccountModal({ initial, onSave, onClose }: {
  initial: AccountRecordRow | null
  onSave: (input: NewAccount) => Promise<{ error?: string }>
  onClose: () => void
}) {
  const { members } = useTeamContext()
  const { team } = useTeamContext()
  const { devices } = useDevices(team?.id ?? null)
  const [platform, setPlatform] = useState<'Instagram' | 'TikTok'>(initial?.platform ?? 'Instagram')
  const [handle, setHandle] = useState(initial?.handle ?? '')
  const [username, setUsername] = useState(initial?.username ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [status, setStatus] = useState<AccountRecordStatus>(initial?.status ?? 'warming')
  const [groupName, setGroupName] = useState(initial?.group_name ?? 'Unassigned')
  const [deviceId, setDeviceId] = useState<string>(initial?.assigned_device_id ?? '')
  const [ownerId, setOwnerId] = useState<string>(initial?.owner_user_id ?? '')
  const [twoFa, setTwoFa] = useState(initial?.two_fa ?? false)
  const [followers, setFollowers] = useState(String(initial?.followers ?? 0))
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '))
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const valid = handle.trim().length > 0
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true); setErr(null)
    const r = await onSave({
      platform, handle: handle.trim(), username: username.trim(), email: email.trim(), status,
      group_name: groupName.trim() || 'Unassigned',
      assigned_device_id: deviceId || null,
      owner_user_id: ownerId || null,
      two_fa: twoFa,
      followers: Math.max(0, Number(followers) || 0),
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      notes: notes.trim(),
    })
    if (r.error) { setErr(r.error); setBusy(false); return }
    onClose()
  }

  const field = 'h-9 w-full rounded-control border border-line bg-elevated px-3 text-[12px] text-fg outline-none transition-colors focus:border-[var(--accent-border)]'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.form
        onSubmit={submit} role="dialog" aria-modal="true" aria-label={initial ? 'Edit account' : 'New account'}
        initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
        transition={{ duration: 0.2, ease: EXPO_OUT }}
        className="relative flex max-h-[85vh] w-[520px] max-w-full flex-col border border-line bg-panel"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <span className="label text-fg">{initial ? 'Edit Account' : 'New Account'}</span>
          <button type="button" onClick={onClose} aria-label="Close" className="text-fg-muted hover:text-fg"><X size={15} /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          <p className="text-[10px] text-white/35">Metadata only — no passwords, recovery codes, or secrets are stored.</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1"><span className="label text-fg-muted">Platform</span>
              <select value={platform} onChange={(e) => setPlatform(e.target.value as 'Instagram' | 'TikTok')} className={field}>{PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}</select>
            </label>
            <label className="space-y-1"><span className="label text-fg-muted">Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as AccountRecordStatus)} className={field}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            </label>
          </div>
          <label className="block space-y-1"><span className="label text-fg-muted">Handle *</span><input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@handle" className={field} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1"><span className="label text-fg-muted">Username</span><input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" className={field} /></label>
            <label className="space-y-1"><span className="label text-fg-muted">Email</span><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" className={field} /></label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1"><span className="label text-fg-muted">Group</span><input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Unassigned" className={field} /></label>
            <label className="space-y-1"><span className="label text-fg-muted">Followers</span><input type="number" min={0} value={followers} onChange={(e) => setFollowers(e.target.value)} className={field} /></label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1"><span className="label text-fg-muted">Assigned device</span>
              <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} className={field}><option value="">— none —</option>{devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
            </label>
            <label className="space-y-1"><span className="label text-fg-muted">Owner</span>
              <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={field}><option value="">— unassigned —</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name || m.email || m.user_id.slice(0, 8)}</option>)}</select>
            </label>
          </div>
          <label className="block space-y-1"><span className="label text-fg-muted">Tags (comma-separated)</span><input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="growth, fashion" className={field} /></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={twoFa} onChange={(e) => setTwoFa(e.target.checked)} /><span className="text-[12px] text-fg-secondary">2FA enabled (flag only — no seed stored)</span></label>
          <label className="block space-y-1"><span className="label text-fg-muted">Notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full rounded-control border border-line bg-elevated px-3 py-2 text-[12px] text-fg outline-none focus:border-[var(--accent-border)]" /></label>
        </div>
        <div className="border-t border-line p-4">
          {err && <p className="mb-2 text-[11px] text-status-error">{err}</p>}
          <button type="submit" disabled={!valid || busy} className="btn-accent w-full py-2.5 text-[11px] uppercase tracking-widest disabled:opacity-40">{busy ? 'Saving…' : 'Save Account'}</button>
        </div>
      </motion.form>
    </div>
  )
}

function ImportModal({ onImport, onClose }: { onImport: (rows: NewAccount[]) => Promise<{ added: number; duplicates: string[]; error?: string }>; onClose: () => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const run = async () => {
    setBusy(true); setResult(null)
    const rows = parseCsv(text)
    const r = await onImport(rows)
    setBusy(false)
    if (r.error) { setResult(`Error: ${r.error}`); return }
    setResult(`Imported ${r.added} account(s).${r.duplicates.length ? ` Skipped ${r.duplicates.length} duplicate username(s).` : ''}`)
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div role="dialog" aria-modal="true" aria-label="Import accounts" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} className="relative flex w-[520px] max-w-full flex-col border border-line bg-panel">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5"><span className="label text-fg">Import Accounts (metadata CSV)</span><button onClick={onClose} aria-label="Close" className="text-fg-muted hover:text-fg"><X size={15} /></button></div>
        <div className="space-y-3 p-5">
          <p className="text-[10px] text-white/40">Columns: {CSV_HEADER}. No password / recovery / secret columns are accepted.</p>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder={CSV_HEADER} className="w-full rounded-control border border-line bg-elevated px-3 py-2 text-[11px] text-fg outline-none focus:border-[var(--accent-border)]" />
          {result && <p className="text-[11px] text-fg-secondary">{result}</p>}
        </div>
        <div className="border-t border-line p-4"><button onClick={() => void run()} disabled={busy || !text.trim()} className="btn-accent w-full py-2.5 text-[11px] uppercase tracking-widest disabled:opacity-40">{busy ? 'Importing…' : 'Import'}</button></div>
      </motion.div>
    </div>
  )
}

export function SupabaseAccountsView() {
  const { team, members } = useTeamContext()
  const { accounts, create, update, remove, importRows } = useAccountRecords(team?.id ?? null)
  const { devices } = useDevices(team?.id ?? null)
  const { member } = useActingEmployee()
  const addToast = useToastStore((s) => s.addToast)
  const canCreate = can(member, 'accounts.create')
  const canEdit = can(member, 'accounts.edit')
  const canDelete = can(member, 'accounts.delete')
  const canImport = can(member, 'accounts.import')
  const canExport = can(member, 'accounts.export')

  const [search, setSearch] = useState('')
  const [platform, setPlatform] = useState<'all' | 'Instagram' | 'TikTok'>('all')
  const [modal, setModal] = useState<{ open: boolean; editing: AccountRecordRow | null }>({ open: false, editing: null })
  const [importing, setImporting] = useState(false)

  const deviceName = useMemo(() => new Map(devices.map((d) => [d.id, d.name])), [devices])
  const ownerName = useMemo(() => new Map(members.map((m) => [m.user_id, m.name || m.email || m.user_id.slice(0, 8)])), [members])

  const visible = accounts.filter((a) =>
    (platform === 'all' || a.platform === platform) &&
    (search === '' || a.handle.toLowerCase().includes(search.toLowerCase()) || a.username.toLowerCase().includes(search.toLowerCase()) || a.email.toLowerCase().includes(search.toLowerCase()) || a.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))),
  )
  const counts = useMemo(() => ({ total: accounts.length, active: accounts.filter((a) => a.status === 'active').length, warming: accounts.filter((a) => a.status === 'warming').length, flagged: accounts.filter((a) => a.status === 'flagged' || a.status === 'banned').length }), [accounts])

  const saveAccount = async (input: NewAccount): Promise<{ error?: string }> =>
    modal.editing ? update(modal.editing.id, input) : create(input)

  const exportCsv = () => {
    if (!canExport) return
    const blob = new Blob([toCsv(visible)], { type: 'text/csv' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'mobfleet-accounts.csv'; a.click(); URL.revokeObjectURL(url)
  }
  const del = async (a: AccountRecordRow) => {
    if (!window.confirm(`Delete account ${a.handle}?`)) return
    const r = await remove(a.id)
    if (r.error) addToast(`Delete failed: ${r.error}`, 'error')
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4">
        <div>
          <p className="mb-1 text-[9px] uppercase tracking-[0.2em] text-white/30">Workspace · Metadata</p>
          <h1 className="text-lg font-bold uppercase tracking-widest text-white">Account Database</h1>
        </div>
        <div className="flex items-center gap-2">
          {canImport && <button onClick={() => setImporting(true)} className="btn-ghost flex h-8 items-center gap-1.5 px-3 text-[10px] uppercase tracking-widest"><Upload size={12} /> Import</button>}
          {canExport && <button onClick={exportCsv} className="btn-ghost flex h-8 items-center gap-1.5 px-3 text-[10px] uppercase tracking-widest"><Download size={12} /> Export</button>}
          <button onClick={() => setModal({ open: true, editing: null })} disabled={!canCreate} title={canCreate ? 'Add an account' : 'Requires create permission'} className="btn-accent flex h-8 items-center gap-1.5 px-4 text-[10px] uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-40"><Plus size={12} /> New Account</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 border-b border-line px-6 py-3">
        {[{ label: 'Total', value: counts.total }, { label: 'Active', value: counts.active }, { label: 'Warming', value: counts.warming }, { label: 'Flagged/Banned', value: counts.flagged }].map((k) => (
          <div key={k.label} className="card-surface flex flex-col px-4 py-2"><span className="text-[10px] uppercase tracking-wider text-white/30">{k.label}</span><span className="mono mt-0.5 text-xl font-semibold tabular-nums text-white/90">{k.value}</span></div>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <select value={platform} onChange={(e) => setPlatform(e.target.value as 'all' | 'Instagram' | 'TikTok')} aria-label="Filter platform" className="h-8 rounded-lg border border-line bg-elevated px-2 text-xs text-white/60 outline-none focus:border-[var(--accent-border)]"><option value="all">All platforms</option>{PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}</select>
          <div className="relative"><Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search accounts..." className="h-8 w-52 rounded-lg border border-line bg-white/[0.03] pl-8 pr-3 text-xs text-white/80 placeholder-white/25 outline-none focus:border-[var(--accent-border)]" /></div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-2">
        <div className="flex items-center gap-3 px-3 py-1.5 text-[9px] font-medium uppercase tracking-wider text-white/20">
          <span className="w-44 shrink-0">Handle</span><span className="w-20 shrink-0">Platform</span><span className="w-20 shrink-0">Status</span>
          <span className="w-28 shrink-0">Group</span><span className="w-24 shrink-0">Followers</span><span className="w-32 shrink-0">Device</span><span className="flex-1">Owner</span><span className="w-20 shrink-0 text-right">Actions</span>
        </div>
        <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-0.5">
          {visible.map((a) => (
            <motion.div key={a.id} variants={fadeRise} className="flex items-center gap-3 rounded-md px-3 py-2 text-[11px] transition-colors hover:bg-white/[0.02]">
              <span className="w-44 shrink-0 truncate"><span className="text-white/80">{a.handle}</span>{a.two_fa && <span className="ml-1.5 rounded bg-white/[0.06] px-1 py-0.5 text-[8px] text-white/40">2FA</span>}</span>
              <span className="w-20 shrink-0 text-white/45">{a.platform}</span>
              <span className="w-20 shrink-0"><StatusPill status={a.status} /></span>
              <span className="w-28 shrink-0 truncate text-white/45">{a.group_name}</span>
              <span className="mono w-24 shrink-0 tabular-nums text-white/55">{a.followers.toLocaleString()}</span>
              <span className="w-32 shrink-0 truncate text-white/45">{a.assigned_device_id ? deviceName.get(a.assigned_device_id) ?? '—' : '—'}</span>
              <span className="flex-1 truncate text-white/45">{a.owner_user_id ? ownerName.get(a.owner_user_id) ?? '—' : '—'}</span>
              <span className="flex w-20 shrink-0 items-center justify-end gap-1">
                {canEdit && <button onClick={() => setModal({ open: true, editing: a })} aria-label="Edit" className="p-1 text-white/35 hover:text-white/80"><Pencil size={13} /></button>}
                {canDelete && <button onClick={() => void del(a)} aria-label="Delete" className="p-1 text-white/35 hover:text-[#ff3b3b]"><Trash2 size={13} /></button>}
              </span>
            </motion.div>
          ))}
        </motion.div>
        {visible.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-[11px] uppercase tracking-widest text-white/25">{accounts.length === 0 ? 'No accounts yet' : 'No accounts match your filters'}</p>
            {accounts.length === 0 && <p className="mt-2 max-w-[300px] text-[10px] leading-relaxed text-white/30">Add account metadata to track handles, status, and assignments. Credentials are never stored here.</p>}
          </div>
        )}
      </div>

      <AnimatePresence>
        {modal.open && <AccountModal key={modal.editing?.id ?? 'new'} initial={modal.editing} onSave={saveAccount} onClose={() => setModal({ open: false, editing: null })} />}
        {importing && <ImportModal onImport={importRows} onClose={() => setImporting(false)} />}
      </AnimatePresence>
    </div>
  )
}
