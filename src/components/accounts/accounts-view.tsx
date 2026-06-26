import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Plus, Upload, Download, Search, Eye, EyeOff, Copy, Check,
  ChevronDown, ChevronRight, X, Camera, Music2,
  ShieldCheck, ShieldOff, Trash2, Pencil, Cpu, Tag, Lock,
} from 'lucide-react'
import { EXPO_OUT } from '@/lib/motion'
import { useDialog } from '@/hooks/use-dialog'
import { useFleet } from '@/hooks/use-fleet'
import { useTeam } from '@/services/team'
import { useToastStore } from '@/state/toast-store'
import { useUIStore } from '@/state/ui-store'
import { useActingEmployee } from '@/lib/authorization/use-access'
import { can, groupInScope, type Member } from '@/lib/authorization'
import { logAudit } from '@/services/audit'
import {
  useAccounts, relTime, parseAccountsCsv, ACCOUNT_STATUSES, ACCOUNT_STATUS_COLOR,
  type Account, type AccountInput, type AccountStatus, type Platform,
} from '@/services/accounts'
import { AUTH_SOURCE } from '@/auth/auth-source'
import { isSupabaseConfigured } from '@/lib/supabase'
import { SupabaseAccountsView } from './supabase-accounts-view'

// In supabase-mode the Account Database is metadata-only (real account_records, NO secrets) —
// rendered by SupabaseAccountsView. The legacy demo/me-mode view below (localStorage store with
// masked credential reveal) is used ONLY when Supabase is not configured.
const SUPABASE_MODE = AUTH_SOURCE === 'supabase' && isSupabaseConfigured

// ─── Shared bits (same language as Phones / Team) ────────────────────────────

function PlatformIcon({ platform, size = 13 }: { platform: Platform; size?: number }) {
  return platform === 'Instagram'
    ? <Camera size={size} className="text-white/55" />
    : <Music2 size={size} className="text-white/55" />
}

function StatusPill({ status }: { status: AccountStatus }) {
  const color = ACCOUNT_STATUS_COLOR[status]
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${status !== 'banned' ? 'status-dot-pulse' : ''}`}
        style={{ background: color, boxShadow: status !== 'banned' ? `0 0 5px ${color}` : 'none' }}
      />
      <span className="text-[10px] uppercase tracking-wider" style={{ color }}>{status}</span>
    </span>
  )
}

/**
 * Masked credential cell. Sensitive values stay masked by default; reveal and
 * copy are gated by an explicit permission and EVERY reveal/copy is written to
 * the security audit log. Without permission the value cannot be unmasked.
 */
function RevealCell({ value, canReveal, onAudit }: {
  value: string
  /** When false, the value can never be unmasked or copied. */
  canReveal: boolean
  /** Fired on reveal and on copy — wire to the audit log. */
  onAudit?: (kind: 'reveal' | 'copy') => void
}) {
  const [shown, setShown] = useState(false)
  const [copied, setCopied] = useState(false)
  const addToast = useToastStore((s) => s.addToast)

  useEffect(() => {
    if (!shown) return
    const id = setTimeout(() => setShown(false), 6000)
    return () => clearTimeout(id)
  }, [shown])

  if (!value) return <span className="text-[10px] text-white/20">—</span>

  // No permission: permanently masked, with a lock affordance.
  if (!canReveal) {
    return (
      <span className="flex items-center gap-1.5" title="You do not have permission to reveal this value">
        <span className="mono text-[11px] text-white/35">••••••</span>
        <Lock size={10} className="text-white/20" />
      </span>
    )
  }

  const reveal = () => {
    setShown((v) => {
      if (!v) onAudit?.('reveal')
      return !v
    })
  }
  const copy = () => {
    navigator.clipboard.writeText(value).catch(() => {})
    setCopied(true)
    onAudit?.('copy')
    addToast('Copied to clipboard', 'success', 1600)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <span className="group/cell flex items-center gap-1.5">
      <span className="mono text-[11px] text-white/50 transition-colors">{shown ? value : '••••••'}</span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); reveal() }}
        aria-label={shown ? 'Hide value' : 'Reveal value'}
        className="p-0.5 text-white/25 opacity-0 transition-all hover:text-white/60 group-hover/cell:opacity-100"
      >
        {shown ? <EyeOff size={11} /> : <Eye size={11} />}
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); copy() }}
        aria-label="Copy value"
        className="p-0.5 text-white/25 opacity-0 transition-all hover:text-white/60 group-hover/cell:opacity-100"
      >
        {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
      </button>
    </span>
  )
}

/** Dropdown filter — identical pattern to the Phones registry. */
function FilterSelect({ label, options, value, onChange }: {
  label: string
  options: string[]
  value: string | null
  onChange: (v: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={[
          'flex h-8 items-center gap-1.5 border px-3 text-[9px] uppercase tracking-widest transition-colors',
          value
            ? 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]'
            : 'border-transparent text-white/30 hover:border-white/20 hover:text-white/60',
        ].join(' ')}
      >
        {label}{value ? `: ${value}` : ''} <ChevronDown size={10} className="text-white/30" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.14 }}
            className="absolute left-0 top-9 z-30 max-h-64 min-w-[150px] overflow-y-auto border border-line bg-elevated py-1 shadow-2xl"
          >
            <button
              type="button"
              onClick={() => { onChange(null); setOpen(false) }}
              className="w-full px-3 py-1.5 text-left text-[10px] uppercase tracking-wider text-white/40 transition-colors hover:bg-hover hover:text-white/80"
            >
              All
            </button>
            {options.map(o => (
              <button
                key={o}
                type="button"
                onClick={() => { onChange(o); setOpen(false) }}
                className={[
                  'w-full px-3 py-1.5 text-left text-[10px] uppercase tracking-wider transition-colors',
                  value === o ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'text-white/55 hover:bg-hover hover:text-white/90',
                ].join(' ')}
              >
                {o}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-2 py-1 text-[10px] text-[var(--accent-text)]">
      {label}
      <button type="button" onClick={onRemove} aria-label={`Remove filter ${label}`} className="opacity-60 transition-opacity hover:opacity-100">
        <X size={10} />
      </button>
    </span>
  )
}

// ─── Add / Edit modal ────────────────────────────────────────────────────────

function AccountModal({ initial, groups, owners, canRevealPw, canRevealRecovery, onClose }: {
  initial: Account | null
  groups: string[]
  owners: string[]
  /** Actor may see existing password plaintext when editing. */
  canRevealPw: boolean
  /** Actor may see existing email/recovery-phone plaintext when editing. */
  canRevealRecovery: boolean
  onClose: () => void
}) {
  const { add, update } = useAccounts()
  const addToast = useToastStore((s) => s.addToast)
  const { employee: actorEmp } = useActingEmployee()
  // SECURITY: editing must NOT expose credentials the actor can't reveal. When
  // a sensitive field is "hidden", it is write-only — never prefilled into the
  // DOM; left blank on save it keeps the stored value, typed it replaces it.
  const pwHidden = Boolean(initial) && !canRevealPw
  const recoveryHidden = Boolean(initial) && !canRevealRecovery
  const [form, setForm] = useState<AccountInput>(() => initial
    ? { ...initial, password: pwHidden ? '' : initial.password, email: recoveryHidden ? '' : initial.email, phone: recoveryHidden ? '' : initial.phone }
    : {
        handle: '', platform: 'Instagram', username: '', email: '', password: '', phone: '',
        assignedPhone: null, group: groups[0] ?? 'Unassigned', owner: owners[0] ?? 'Unassigned',
        twoFA: false, status: 'warming', tags: [], followers: 0, notes: '',
      })
  const [showPassword, setShowPassword] = useState(false)
  const [dirty, setDirty] = useState(false)
  const set = <K extends keyof AccountInput>(k: K, v: AccountInput[K]) => {
    setForm(f => ({ ...f, [k]: v }))
    setDirty(true)
  }

  // A hidden recovery email validates against the stored value (unchanged & valid).
  const emailToCheck = form.email.trim() ? form.email : recoveryHidden ? (initial?.email ?? '') : form.email
  const valid = form.handle.trim().length > 1 && form.username.trim().length > 1 && /\S+@\S+\.\S+/.test(emailToCheck)

  const save = () => {
    if (!valid) return
    const keep = (typed: string, hidden: boolean, original: string | undefined) =>
      hidden && !typed.trim() ? (original ?? '') : typed
    const clean: AccountInput = {
      ...form,
      handle: form.handle.startsWith('@') ? form.handle : '@' + form.handle,
      password: keep(form.password, pwHidden, initial?.password),
      email: keep(form.email, recoveryHidden, initial?.email),
      phone: keep(form.phone, recoveryHidden, initial?.phone),
    }
    if (initial) update(initial.id, clean)
    else add(clean)
    logAudit({ actor: actorEmp.name, action: initial ? 'account.updated' : 'account.created', target: clean.handle, result: 'success' })
    addToast(initial ? 'Account updated' : 'Account created', 'success')
    onClose()
  }

  const tryClose = () => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return
    onClose()
  }
  const dialogRef = useDialog<HTMLDivElement>(tryClose)

  const input = 'h-9 w-full rounded-control border border-line bg-elevated px-3 text-[12px] text-fg outline-none transition-colors focus:border-[var(--accent-border)]'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={tryClose} />
      <motion.div
        ref={dialogRef} tabIndex={-1}
        role="dialog" aria-modal="true" aria-label={initial ? 'Edit account' : 'Add account'}
        initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
        transition={{ duration: 0.2, ease: EXPO_OUT }}
        className="relative flex max-h-[85vh] w-[440px] flex-col border border-line bg-panel focus:outline-none"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <span className="label text-fg">{initial ? 'Edit Account' : 'Add Account'}</span>
          <button onClick={tryClose} aria-label="Close" className="text-fg-muted hover:text-fg"><X size={15} /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="label mb-1.5 text-fg-muted">Handle</div>
              <input value={form.handle} onChange={e => set('handle', e.target.value)} placeholder="@handle" className={input} />
            </div>
            <div>
              <div className="label mb-1.5 text-fg-muted">Platform</div>
              <select value={form.platform} onChange={e => set('platform', e.target.value as Platform)} className={input} aria-label="Platform">
                <option>Instagram</option>
                <option>TikTok</option>
              </select>
            </div>
          </div>
          <div>
            <div className="label mb-1.5 text-fg-muted">Username</div>
            <input value={form.username} onChange={e => set('username', e.target.value)} placeholder="username" className={input} />
          </div>
          <div>
            <label className="label mb-1.5 block text-fg-muted" htmlFor="acct-email">Email{recoveryHidden && <span className="ml-1 normal-case tracking-normal text-white/30">· hidden, type to replace</span>}</label>
            <input id="acct-email" value={form.email} onChange={e => set('email', e.target.value)}
              placeholder={recoveryHidden ? '•••••• (no reveal permission)' : 'name@domain.com'}
              className={[input, form.email && !/\S+@\S+\.\S+/.test(form.email) ? '!border-status-error' : ''].join(' ')} />
          </div>
          <div>
            <label className="label mb-1.5 block text-fg-muted" htmlFor="acct-password">Email Password{pwHidden && <span className="ml-1 normal-case tracking-normal text-white/30">· hidden, type to replace</span>}</label>
            <div className="relative">
              <input
                id="acct-password"
                type={showPassword && !pwHidden ? 'text' : 'password'}
                value={form.password}
                onChange={e => set('password', e.target.value)}
                placeholder={pwHidden ? '•••••• (no reveal permission)' : '••••••••'}
                autoComplete="new-password"
                className={[input, 'pr-9'].join(' ')}
              />
              {!pwHidden && (
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/25 transition-colors hover:text-white/60"
                >
                  {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              )}
            </div>
          </div>
          <div>
            <label className="label mb-1.5 block text-fg-muted" htmlFor="acct-phone">Phone{recoveryHidden && <span className="ml-1 normal-case tracking-normal text-white/30">· hidden, type to replace</span>}</label>
            <input id="acct-phone" value={form.phone} onChange={e => set('phone', e.target.value)}
              placeholder={recoveryHidden ? '•••••• (no reveal permission)' : '+1-555-0100'} className={input} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="label mb-1.5 text-fg-muted">Group</div>
              <select value={form.group} onChange={e => set('group', e.target.value)} className={input} aria-label="Group">
                {[...new Set([form.group, ...groups])].map(g => <option key={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <div className="label mb-1.5 text-fg-muted">Owner</div>
              <select value={form.owner} onChange={e => set('owner', e.target.value)} className={input} aria-label="Owner">
                {[...new Set([form.owner, ...owners])].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="label mb-1.5 text-fg-muted">Status</div>
              <select value={form.status} onChange={e => set('status', e.target.value as AccountStatus)} className={input} aria-label="Status">
                {ACCOUNT_STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex cursor-pointer items-center gap-2.5">
                <button
                  type="button" role="switch" aria-checked={form.twoFA} aria-label="Two-factor enabled"
                  onClick={() => set('twoFA', !form.twoFA)}
                  className="relative h-5 w-9 rounded-full transition-colors"
                  style={{ background: form.twoFA ? 'var(--accent)' : 'rgba(148,163,184,0.18)' }}
                >
                  <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform" style={{ transform: form.twoFA ? 'translateX(18px)' : 'translateX(2px)' }} />
                </button>
                <span className="text-[11px] text-white/60">2FA enabled</span>
              </label>
            </div>
          </div>
          <div>
            <div className="label mb-1.5 text-fg-muted">Tags (comma-separated)</div>
            <input
              value={form.tags.join(', ')}
              onChange={e => set('tags', e.target.value.split(',').map(t => t.trim()).filter(Boolean))}
              placeholder="growth, warmup"
              className={input}
            />
          </div>
          <div>
            <div className="label mb-1.5 text-fg-muted">Notes</div>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
              className="w-full resize-none rounded-control border border-line bg-elevated p-3 text-[12px] text-fg outline-none transition-colors focus:border-[var(--accent-border)]" />
          </div>
        </div>
        <div className="flex gap-2 border-t border-line p-4">
          <button onClick={tryClose} className="btn-ghost flex-1 py-2.5 text-[11px] uppercase tracking-widest">Cancel</button>
          <button
            onClick={save}
            disabled={!valid}
            title={!valid ? 'Handle, username, and a valid email are required' : undefined}
            className="btn-accent flex-1 py-2.5 text-[11px] uppercase tracking-widest"
          >
            {initial ? 'Save Changes' : 'Create Account'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ─── Import modal (drag & drop CSV) ──────────────────────────────────────────

function ImportModal({ onClose }: { onClose: () => void }) {
  const importMany = useAccounts((s) => s.importMany)
  const addToast = useToastStore((s) => s.addToast)
  const { employee: actorEmp } = useActingEmployee()
  const [rows, setRows] = useState<AccountInput[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const readFile = (file: File) => {
    setFileName(file.name)
    void file.text().then((text) => setRows(parseAccountsCsv(text)))
  }

  const doImport = () => {
    if (!rows?.length) return
    const { added, duplicates } = importMany(rows)
    logAudit({ actor: actorEmp.name, action: 'accounts.imported', target: `${added} accounts`, detail: duplicates.length ? `${duplicates.length} duplicates skipped` : undefined, result: 'success' })
    addToast(
      duplicates.length
        ? `Imported ${added} accounts — ${duplicates.length} duplicates skipped`
        : `Imported ${added} accounts`,
      duplicates.length ? 'warning' : 'success',
    )
    onClose()
  }

  const dialogRef = useDialog<HTMLDivElement>(onClose)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        ref={dialogRef} tabIndex={-1}
        role="dialog" aria-modal="true" aria-label="Import accounts"
        initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
        transition={{ duration: 0.2, ease: EXPO_OUT }}
        className="relative w-[440px] border border-line bg-panel focus:outline-none"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <span className="label text-fg">Import Accounts</span>
          <button onClick={onClose} aria-label="Close" className="text-fg-muted hover:text-fg"><X size={15} /></button>
        </div>
        <div className="p-5">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              const f = e.dataTransfer.files?.[0]
              if (f) readFile(f)
            }}
            className={[
              'flex w-full flex-col items-center gap-2 border border-dashed px-4 py-9 transition-colors',
              dragOver ? 'border-[var(--accent-border)] bg-[var(--accent-soft)]' : 'border-line hover:bg-hover',
            ].join(' ')}
          >
            <Upload size={18} className="text-white/30" />
            <span className="text-[12px] text-white/60">Drop a CSV here or click to browse</span>
            <span className="text-[9px] uppercase tracking-wider text-white/25">handle, platform, username, email, phone, group, owner, password</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) readFile(f)
            }}
          />
          {rows && (
            <div className="mt-3 border border-line bg-black/30 px-3 py-2.5">
              <div className="text-[11px] text-white/70">{fileName}</div>
              <div className="mt-0.5 text-[10px] text-white/35">
                {rows.length} account{rows.length === 1 ? '' : 's'} parsed — duplicates are skipped on import.
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-2 border-t border-line p-4">
          <button onClick={onClose} className="btn-ghost flex-1 py-2.5 text-[11px] uppercase tracking-widest">Cancel</button>
          <button
            onClick={doImport}
            disabled={!rows?.length}
            title={!rows?.length ? 'Choose a CSV file first' : undefined}
            className="btn-accent flex-1 py-2.5 text-[11px] uppercase tracking-widest"
          >
            Import{rows?.length ? ` (${rows.length})` : ''}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ─── Account detail drawer (same shell as the device sidebar) ────────────────

function AccountDrawer({ account, onClose, onEdit }: {
  account: Account
  onClose: () => void
  onEdit: () => void
}) {
  const { update, remove } = useAccounts()
  const snapshot = useFleet()
  const employees = useTeam((s) => s.employees)
  const openPhoneControl = useUIStore((s) => s.openPhoneControl)
  const addToast = useToastStore((s) => s.addToast)
  const { employee: actorEmp, member: actor } = useActingEmployee()
  const [notes, setNotes] = useState(account.notes)
  const statusColor = ACCOUNT_STATUS_COLOR[account.status]

  // Sensitive-data + mutation permissions for the acting user.
  const canRevealPw       = can(actor, 'accounts.reveal_password')
  const canRevealRecovery = can(actor, 'accounts.reveal_recovery')
  const canEdit           = can(actor, 'accounts.edit')
  const canDelete         = can(actor, 'accounts.delete')
  const auditReveal = (field: 'password' | 'recovery', kind: 'reveal' | 'copy') => {
    logAudit({
      actor: actorEmp.name,
      action: field === 'password' ? 'account.password_revealed' : 'account.recovery_revealed',
      target: account.handle,
      detail: kind === 'copy' ? 'copied to clipboard' : 'revealed',
      result: 'success',
    })
  }

  const assignedDevice = account.assignedPhone
    ? snapshot.devices.find((d) => d.name === account.assignedPhone)
    : undefined

  const dialogRef = useDialog<HTMLDivElement>(onClose)

  const copy = (label: string, value: string) => {
    navigator.clipboard.writeText(value).catch(() => {})
    addToast(`${label} copied`, 'success', 1600)
  }

  const select = 'h-8 w-full rounded-control border border-line bg-elevated px-2 text-[11px] text-fg-secondary outline-none focus:border-[var(--accent-border)]'

  return (
    <motion.div
      ref={dialogRef} tabIndex={-1}
      role="dialog"
      aria-label={`Account ${account.handle}`}
      className="fixed right-0 top-0 z-40 flex h-full w-[420px] max-w-[94vw] flex-col border-l border-line bg-panel shadow-[-24px_0_60px_-30px_rgba(0,0,0,0.8)] focus:outline-none"
      initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
      transition={{ duration: 0.3, ease: EXPO_OUT }}
    >
      <div className="absolute inset-x-0 top-0 z-10 h-[2px]" style={{ background: `linear-gradient(90deg, transparent, ${statusColor}, transparent)` }} />

      {/* header */}
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center border border-line bg-black/40">
            <PlatformIcon platform={account.platform} size={14} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-fg">{account.handle}</div>
            <div className="label mt-0.5 text-fg-muted">{account.platform} · {account.group}</div>
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-elevated hover:text-fg">
          <X size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* summary */}
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div className="flex items-center gap-3">
            <StatusPill status={account.status} />
            {account.twoFA ? (
              <span className="flex items-center gap-1 text-[10px] text-emerald-400"><ShieldCheck size={11} /> 2FA</span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] text-white/25"><ShieldOff size={11} /> No 2FA</span>
            )}
          </div>
          <div className="text-right">
            <div className="mono text-lg font-bold tabular-nums text-white/85">{account.followers.toLocaleString()}</div>
            <div className="text-[9px] uppercase tracking-wider text-white/25">Followers</div>
          </div>
        </div>

        {/* login information — masked, explicit reveal */}
        <div className="border-b border-line px-5 py-3">
          <div className="label mb-2 text-fg-muted">Login Information</div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-white/25">Username</span>
              <span className="text-[11px] text-white/60">{account.username}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-white/25">Email</span>
              <RevealCell value={account.email} canReveal={canRevealRecovery} onAudit={(k) => auditReveal('recovery', k)} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-white/25">Email Password</span>
              <RevealCell value={account.password} canReveal={canRevealPw} onAudit={(k) => auditReveal('password', k)} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-white/25">Recovery Phone</span>
              <RevealCell value={account.phone} canReveal={canRevealRecovery} onAudit={(k) => auditReveal('recovery', k)} />
            </div>
          </div>
        </div>

        {/* assignment — live selects against fleet + team */}
        <div className="space-y-2.5 border-b border-line px-5 py-3">
          <div className="label text-fg-muted">Assignment</div>
          <div>
            <div className="mb-1 text-[10px] text-white/25">Assigned Phone</div>
            <select
              value={account.assignedPhone ?? ''}
              onChange={(e) => update(account.id, { assignedPhone: e.target.value || null })}
              disabled={!canEdit}
              aria-label="Assigned phone"
              className={`${select} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <option value="">Unassigned</option>
              {snapshot.devices.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <div className="mb-1 text-[10px] text-white/25">Group</div>
              <select
                value={account.group}
                onChange={(e) => update(account.id, { group: e.target.value })}
                disabled={!canEdit}
                aria-label="Group"
                className={`${select} disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {[...new Set([account.group, ...snapshot.devices.map((d) => d.group)])].sort().map((g) => <option key={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <div className="mb-1 text-[10px] text-white/25">Owner</div>
              <select
                value={account.owner}
                onChange={(e) => update(account.id, { owner: e.target.value })}
                disabled={!canEdit}
                aria-label="Owner"
                className={`${select} disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {[...new Set([account.owner, ...employees.map((e) => e.name)])].map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* status + tags */}
        <div className="space-y-2.5 border-b border-line px-5 py-3">
          <div>
            <div className="label mb-1.5 text-fg-muted">Status</div>
            <div className="flex gap-1.5">
              {ACCOUNT_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => update(account.id, { status: s })}
                  disabled={!canEdit}
                  className={[
                    'border px-2 py-1 text-[9px] uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                    account.status === s ? 'border-[var(--accent-border)] bg-[var(--accent-soft)]' : 'border-line text-white/40 enabled:hover:bg-hover',
                  ].join(' ')}
                  style={account.status === s ? { color: ACCOUNT_STATUS_COLOR[s] } : undefined}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="label mb-1.5 text-fg-muted">Tags</div>
            <div className="flex flex-wrap items-center gap-1">
              {account.tags.map((t) => (
                <span key={t} className="flex items-center gap-1 rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[9px] text-[var(--accent-text)]">
                  <Tag size={8} /> {t}
                  {canEdit && (
                    <button
                      type="button"
                      aria-label={`Remove tag ${t}`}
                      onClick={() => update(account.id, { tags: account.tags.filter((x) => x !== t) })}
                      className="opacity-50 hover:opacity-100"
                    >
                      <X size={8} />
                    </button>
                  )}
                </span>
              ))}
              {canEdit && (
                <input
                  placeholder="+ tag"
                  onKeyDown={(e) => {
                    const v = (e.target as HTMLInputElement).value.trim()
                    if (e.key === 'Enter' && v) {
                      update(account.id, { tags: [...new Set([...account.tags, v])] })
                      ;(e.target as HTMLInputElement).value = ''
                    }
                  }}
                  className="h-6 w-16 border border-line bg-transparent px-1.5 text-[9px] text-white/60 outline-none placeholder-white/20 focus:border-[var(--accent-border)]"
                />
              )}
            </div>
          </div>
        </div>

        {/* notes */}
        <div className="border-b border-line px-5 py-3">
          <div className="label mb-2 text-fg-muted">Notes</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            readOnly={!canEdit}
            placeholder={canEdit ? 'Add notes…' : 'View only'}
            className="w-full resize-none rounded-control border border-line bg-elevated p-2.5 text-[11px] text-fg-secondary outline-none transition-colors focus:border-[var(--accent-border)] read-only:opacity-60"
          />
          {canEdit && notes !== account.notes && (
            <button
              type="button"
              onClick={() => { update(account.id, { notes }); addToast('Notes saved', 'success', 1600) }}
              className="btn-accent mt-2 px-3 py-1.5 text-[10px] uppercase tracking-widest"
            >
              Save Notes
            </button>
          )}
        </div>

        {/* activity */}
        <div className="border-b border-line px-5 py-3">
          <div className="label mb-2 text-fg-muted">Activity</div>
          <div className="space-y-1.5 border-l border-line pl-3">
            <div className="flex items-baseline gap-2.5">
              <span className="mono text-[10px] tabular-nums text-white/30">{relTime(account.updatedAt)}</span>
              <span className="text-[11px] text-white/55">Record updated</span>
            </div>
          </div>
        </div>

        {/* quick actions */}
        <div className="flex flex-wrap gap-2 px-5 py-4">
          <button
            type="button"
            disabled={!assignedDevice}
            title={assignedDevice ? `Open phone control for ${assignedDevice.name}` : 'No fleet phone assigned to this account'}
            onClick={() => assignedDevice && openPhoneControl(assignedDevice.id)}
            className="btn-accent flex items-center gap-1.5 px-3 py-2 text-[10px] uppercase tracking-widest"
          >
            <Cpu size={12} /> Open Phone Control
          </button>
          <button type="button" onClick={() => copy('Username', account.username)} className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-[10px] uppercase tracking-widest">
            <Copy size={11} /> Username
          </button>
          <button
            type="button"
            disabled={!canRevealRecovery}
            title={canRevealRecovery ? 'Copy email' : 'Requires reveal-recovery permission'}
            onClick={() => { copy('Email', account.email); auditReveal('recovery', 'copy') }}
            className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-[10px] uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Copy size={11} /> Email
          </button>
          {canEdit && (
            <button type="button" onClick={onEdit} className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-[10px] uppercase tracking-widest">
              <Pencil size={11} /> Edit
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={() => {
                if (!window.confirm(`Delete ${account.handle}? This cannot be undone.`)) return
                remove([account.id])
                logAudit({ actor: actorEmp.name, action: 'account.deleted', target: account.handle, result: 'success' })
                addToast('Account deleted', 'success')
                onClose()
              }}
              className="flex items-center gap-1.5 border border-status-error/25 px-3 py-2 text-[10px] uppercase tracking-widest text-status-error transition-colors hover:bg-status-error/10"
            >
              <Trash2 size={11} /> Delete
            </button>
          )}
        </div>
      </div>
    </motion.div>
  )
}

// ─── Scope filter ────────────────────────────────────────────────────────────
// SECURITY: filter accounts to the member's resource scope at the selector
// boundary. Mirror this predicate in the server query — never ship the whole
// workspace and hide rows in the browser.
function scopeAccounts(member: Member, selfName: string, accounts: Account[]): Account[] {
  if (!can(member, 'accounts.view')) return []
  switch (member.scope.type) {
    case 'workspace':       return accounts
    case 'assigned_groups': return accounts.filter((a) => groupInScope(member.scope, a.group))
    case 'assigned_phones': return accounts.filter((a) => a.assignedPhone != null && member.scope.phones.includes(a.assignedPhone))
    case 'self':            return accounts.filter((a) => a.owner === selfName)
  }
}

// ─── Main view ───────────────────────────────────────────────────────────────

function DemoAccountsView() {
  const { accounts: allAccounts, update, remove } = useAccounts()
  const snapshot = useFleet()
  const employees = useTeam((s) => s.employees)
  const addToast = useToastStore((s) => s.addToast)
  const { employee: actorEmp, member: actor } = useActingEmployee()

  // Action permissions for the acting user.
  const canRevealPw       = can(actor, 'accounts.reveal_password')
  const canRevealRecovery = can(actor, 'accounts.reveal_recovery')
  const canCreate = can(actor, 'accounts.create')
  const canEdit   = can(actor, 'accounts.edit')
  const canDelete = can(actor, 'accounts.delete')
  const canExport = can(actor, 'accounts.export')
  const canImport = can(actor, 'accounts.import')

  // Scope filtering at the selector boundary — accounts outside the member's
  // resource scope never reach the table. The same predicate belongs server-side.
  const accounts = useMemo(
    () => scopeAccounts(actor, actorEmp.name, allAccounts),
    [actor, actorEmp.name, allAccounts],
  )

  const [search, setSearch] = useState('')
  const [platFilter, setPlatFilter] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [groupFilter, setGroupFilter] = useState<string | null>(null)
  const [ownerFilter, setOwnerFilter] = useState<string | null>(null)
  const [fa2Filter, setFa2Filter] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [drawerId, setDrawerId] = useState<string | null>(null)
  const [modal, setModal] = useState<'add' | 'edit' | 'import' | null>(null)
  const [statusMenuOpen, setStatusMenuOpen] = useState(false)

  const groups = useMemo(() => [...new Set(accounts.map(a => a.group))].sort(), [accounts])
  const owners = useMemo(() => [...new Set(accounts.map(a => a.owner))].sort(), [accounts])
  const fleetGroups = useMemo(() => [...new Set(snapshot.devices.map(d => d.group))].sort(), [snapshot.devices])
  const teamNames = useMemo(() => employees.map(e => e.name), [employees])

  const visible = useMemo(() => accounts.filter(a => {
    if (platFilter && a.platform !== platFilter) return false
    if (statusFilter && a.status !== statusFilter) return false
    if (groupFilter && a.group !== groupFilter) return false
    if (ownerFilter && a.owner !== ownerFilter) return false
    if (fa2Filter === 'Yes' && !a.twoFA) return false
    if (fa2Filter === 'No' && a.twoFA) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        a.username.toLowerCase().includes(q) ||
        a.handle.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q) ||
        (a.assignedPhone ?? '').toLowerCase().includes(q)
      )
    }
    return true
  }), [accounts, platFilter, statusFilter, groupFilter, ownerFilter, fa2Filter, search])

  const filtersActive = platFilter || statusFilter || groupFilter || ownerFilter || fa2Filter || search

  const kpis = [
    { label: 'TOTAL ACCOUNTS', value: accounts.length, color: '#ffffff', top: 'rgba(255,255,255,0.3)' },
    { label: 'INSTAGRAM', value: accounts.filter(a => a.platform === 'Instagram').length, color: 'rgba(255,255,255,0.7)', top: 'rgba(255,255,255,0.2)' },
    { label: 'TIKTOK', value: accounts.filter(a => a.platform === 'TikTok').length, color: 'rgba(255,255,255,0.7)', top: 'rgba(255,255,255,0.2)' },
    { label: 'ISSUES', value: accounts.filter(a => a.status === 'flagged' || a.status === 'banned').length, color: 'var(--accent-red)', top: 'var(--accent-red)' },
    { label: 'UNASSIGNED', value: accounts.filter(a => !a.assignedPhone).length, color: 'var(--accent-amber)', top: 'var(--accent-amber)' },
  ]

  const toggle = (id: string) =>
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const toggleAll = () =>
    setSelected(prev => prev.size === visible.length ? new Set() : new Set(visible.map(a => a.id)))

  const exportRows = (rows: Account[]) => {
    if (!canExport) { addToast('You lack permission to export accounts', 'error'); return }
    // SECURITY: a CSV is an unaudited copy of the data. Only include credential
    // columns the actor is actually permitted to reveal — export must not be a
    // backdoor around accounts.reveal_password / accounts.reveal_recovery.
    const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
    const cols: { head: string; get: (a: Account) => string }[] = [
      { head: 'handle', get: a => a.handle },
      { head: 'platform', get: a => a.platform },
      { head: 'username', get: a => a.username },
      ...(canRevealRecovery ? [{ head: 'email', get: (a: Account) => a.email }, { head: 'phone', get: (a: Account) => a.phone }] : []),
      { head: 'group', get: a => a.group },
      { head: 'owner', get: a => a.owner },
      ...(canRevealPw ? [{ head: 'password', get: (a: Account) => a.password }] : []),
      { head: '2fa', get: a => (a.twoFA ? 'yes' : 'no') },
      { head: 'status', get: a => a.status },
    ]
    const header = cols.map(c => c.head).join(',')
    const csv = [header, ...rows.map(a => cols.map(c => csvCell(c.get(a))).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'mobfleet-accounts.csv'
    link.click()
    URL.revokeObjectURL(url)
    const sensitive = [canRevealRecovery && 'recovery', canRevealPw && 'passwords'].filter(Boolean).join('+') || 'no credentials'
    logAudit({ actor: actorEmp.name, action: 'accounts.exported', target: `${rows.length} accounts`, detail: `CSV (${sensitive})`, result: 'success' })
    addToast(`Exported ${rows.length} accounts${canRevealPw || canRevealRecovery ? '' : ' (credentials excluded)'}`, 'success')
  }

  const drawerAcc = drawerId ? accounts.find(a => a.id === drawerId) ?? null : null
  const editAcc = modal === 'edit' ? drawerAcc : null

  return (
    <div className="relative flex h-full flex-col">
      {/* Header — global page-header pattern */}
      <div className="flex items-center justify-between border-b border-line px-6 py-5">
        <div>
          <p className="mb-1 text-[9px] uppercase tracking-[0.2em] text-white/30">Data Vault</p>
          <h1 className="text-lg font-bold uppercase tracking-widest text-white">Account Database</h1>
          <p className="mt-0.5 text-[10px] tracking-wider text-white/30">
            {accounts.length} ACCOUNTS · CREDENTIALS &amp; DEVICE ASSIGNMENTS
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportRows(selected.size ? accounts.filter(a => selected.has(a.id)) : visible)}
            disabled={!canExport}
            title={!canExport ? 'Requires export permission' : selected.size ? `Export ${selected.size} selected` : 'Export the current view as CSV'}
            className="btn-ghost flex h-8 items-center gap-1.5 px-3 text-[10px] uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download size={11} /> Export
          </button>
          <button
            onClick={() => setModal('import')}
            disabled={!canImport}
            title={canImport ? 'Import accounts from CSV' : 'Requires import permission'}
            className="btn-ghost flex h-8 items-center gap-1.5 px-3 text-[10px] uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Upload size={11} /> Import
          </button>
          <button
            onClick={() => setModal('add')}
            disabled={!canCreate}
            title={canCreate ? 'Add a new account' : 'Requires create permission'}
            className="btn-accent flex h-8 items-center gap-1.5 px-4 text-[10px] uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus size={12} /> Add Account
          </button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-5 gap-3 border-b border-line px-6 py-4">
        {kpis.map(({ label, value, color, top }, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: i * 0.05, ease: EXPO_OUT }}
            className="hud-corners flex flex-col gap-2 p-4"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderTop: `2px solid ${top}`,
              ['--hud-c' as string]: top,
            }}
          >
            <span className="text-[9px] uppercase tracking-[0.15em] text-white/40">{label}</span>
            <span className="mono text-3xl font-bold tabular-nums" style={{ color }}>{value}</span>
          </motion.div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 border-b border-line px-6 py-3">
        <div className="relative max-w-xs flex-1">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="SEARCH ACCOUNTS..."
            aria-label="Search accounts"
            className="h-8 w-full border border-line bg-transparent pl-8 pr-3 text-[10px] tracking-wider text-white/70 placeholder-white/20 outline-none transition-colors focus:border-[var(--accent-border)]"
          />
        </div>
        <FilterSelect label="Platform" options={['Instagram', 'TikTok']} value={platFilter} onChange={setPlatFilter} />
        <FilterSelect label="Status" options={[...ACCOUNT_STATUSES]} value={statusFilter} onChange={setStatusFilter} />
        <FilterSelect label="Group" options={groups} value={groupFilter} onChange={setGroupFilter} />
        <FilterSelect label="Owner" options={owners} value={ownerFilter} onChange={setOwnerFilter} />
        <FilterSelect label="2FA" options={['Yes', 'No']} value={fa2Filter} onChange={setFa2Filter} />
        <span className="ml-auto text-[9px] uppercase tracking-widest text-white/25">
          {visible.length} OF {accounts.length} SHOWN
        </span>
      </div>

      {/* Active filter chips */}
      {filtersActive && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-6 py-2">
          {platFilter && <Chip label={`Platform: ${platFilter}`} onRemove={() => setPlatFilter(null)} />}
          {statusFilter && <Chip label={`Status: ${statusFilter}`} onRemove={() => setStatusFilter(null)} />}
          {groupFilter && <Chip label={`Group: ${groupFilter}`} onRemove={() => setGroupFilter(null)} />}
          {ownerFilter && <Chip label={`Owner: ${ownerFilter}`} onRemove={() => setOwnerFilter(null)} />}
          {fa2Filter && <Chip label={`2FA: ${fa2Filter}`} onRemove={() => setFa2Filter(null)} />}
          {search && <Chip label={`"${search}"`} onRemove={() => setSearch('')} />}
          <button
            type="button"
            onClick={() => { setPlatFilter(null); setStatusFilter(null); setGroupFilter(null); setOwnerFilter(null); setFa2Filter(null); setSearch('') }}
            className="px-2 py-1 text-[9px] uppercase tracking-widest text-white/35 transition-colors hover:text-white/75"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full min-w-[1020px] text-xs">
          <thead className="sticky top-0 z-10 bg-black">
            <tr className="border-b border-line">
              <th scope="col" className="w-8 px-4 py-3 text-left">
                <button
                  onClick={toggleAll}
                  aria-label="Select all"
                  className="flex h-3.5 w-3.5 items-center justify-center border border-white/20 transition-colors hover:border-white/50"
                  style={{ background: selected.size === visible.length && visible.length > 0 ? 'rgba(255,255,255,0.9)' : 'transparent' }}
                >
                  {selected.size === visible.length && visible.length > 0 && <Check size={8} className="text-black" />}
                </button>
              </th>
              {['ACCOUNT', 'USERNAME', 'EMAIL', 'ASSIGNED PHONE', 'GROUP', 'OWNER', '2FA', 'STATUS', 'UPDATED', ''].map(h => (
                <th scope="col" key={h} className="whitespace-nowrap px-3 py-3 text-left text-[9px] font-medium uppercase tracking-[0.1em] text-white/25">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((a, i) => {
              const isSel = selected.has(a.id)
              return (
                <motion.tr
                  key={a.id}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  transition={{ duration: 0.25, delay: Math.min(i * 0.018, 0.4) }}
                  onClick={() => setDrawerId(a.id)}
                  className="cursor-pointer border-b border-white/[0.04] transition-colors hover:bg-hover"
                  style={{
                    borderLeft: isSel ? '2px solid var(--accent)' : '2px solid transparent',
                    background: isSel ? 'var(--accent-soft)' : undefined,
                  }}
                >
                  <td className="px-4 py-3" onClick={e => { e.stopPropagation(); toggle(a.id) }}>
                    <div
                      className="flex h-3.5 w-3.5 items-center justify-center border border-white/15 transition-colors"
                      style={{ background: isSel ? 'rgba(255,255,255,0.9)' : 'transparent' }}
                    >
                      {isSel && <Check size={8} className="text-black" />}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <span className="flex items-center gap-2">
                      <PlatformIcon platform={a.platform} />
                      <span className="text-[12px] font-medium text-white/75">{a.handle}</span>
                    </span>
                  </td>
                  <td className="px-3 py-3 text-[11px] text-white/55">{a.username}</td>
                  <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                    <RevealCell
                      value={a.email}
                      canReveal={canRevealRecovery}
                      onAudit={(k) => logAudit({ actor: actorEmp.name, action: 'account.recovery_revealed', target: a.handle, detail: k === 'copy' ? 'copied' : 'revealed', result: 'success' })}
                    />
                  </td>
                  <td className="px-3 py-3">
                    {a.assignedPhone
                      ? <span className="text-[11px] text-white/55">{a.assignedPhone}</span>
                      : <span className="text-[10px] text-white/20">—</span>}
                  </td>
                  <td className="px-3 py-3 text-[11px] text-white/40">{a.group}</td>
                  <td className="px-3 py-3 text-[11px] text-white/40">{a.owner}</td>
                  <td className="px-3 py-3">
                    {a.twoFA
                      ? <ShieldCheck size={13} className="text-emerald-400" role="img" aria-label="Two-factor enabled" />
                      : <ShieldOff size={13} className="text-white/20" role="img" aria-label="Two-factor disabled" />}
                  </td>
                  <td className="px-3 py-3"><StatusPill status={a.status} /></td>
                  <td className="mono px-3 py-3 text-[10px] text-white/30">{relTime(a.updatedAt)}</td>
                  <td className="px-3 py-3 text-right"><ChevronRight size={13} className="ml-auto text-white/20" /></td>
                </motion.tr>
              )
            })}
          </tbody>
        </table>
        {visible.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <span className="text-[10px] uppercase tracking-widest text-white/30">
              {accounts.length === 0 ? 'No accounts yet' : 'No accounts match the current filters'}
            </span>
            {accounts.length === 0 && (
              <button onClick={() => setModal('add')} className="btn-accent px-4 py-2 text-[10px] uppercase tracking-widest">
                <Plus size={11} className="mr-1 inline" /> Add your first account
              </button>
            )}
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
            transition={{ duration: 0.28, ease: EXPO_OUT }}
            className="absolute bottom-4 left-1/2 z-30 -translate-x-1/2"
          >
            <div className="relative flex items-center gap-2 border border-white/[0.15] bg-black px-4 py-2.5 shadow-2xl">
              <span className="mr-1 whitespace-nowrap text-[9px] uppercase tracking-widest text-white/40">{selected.size} SELECTED</span>
              <div className="h-4 w-px bg-white/[0.08]" />
              <div className="relative">
                <button
                  type="button"
                  onClick={() => { if (!canEdit) { addToast('You lack permission to edit accounts', 'error'); return } setStatusMenuOpen(o => !o) }}
                  disabled={!canEdit}
                  title={canEdit ? 'Set status on selected accounts' : 'Requires edit permission'}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[9px] uppercase tracking-widest text-white/50 transition-colors enabled:hover:bg-white/[0.06] enabled:hover:text-white/90 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ShieldCheck size={11} /> SET STATUS
                </button>
                <AnimatePresence>
                  {statusMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
                      transition={{ duration: 0.14 }}
                      className="absolute bottom-9 left-0 min-w-[130px] border border-line bg-elevated py-1 shadow-2xl"
                    >
                      {ACCOUNT_STATUSES.map(s => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => {
                            selected.forEach(id => update(id, { status: s }))
                            addToast(`Status set to ${s} on ${selected.size} accounts`, 'success')
                            setStatusMenuOpen(false)
                            setSelected(new Set())
                          }}
                          className="w-full px-3 py-1.5 text-left text-[10px] uppercase tracking-wider text-white/55 transition-colors hover:bg-hover hover:text-white/90"
                          style={{ color: ACCOUNT_STATUS_COLOR[s] }}
                        >
                          {s}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <button
                type="button"
                onClick={() => exportRows(accounts.filter(a => selected.has(a.id)))}
                disabled={!canExport}
                title={canExport ? 'Export selected' : 'Requires export permission'}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[9px] uppercase tracking-widest text-white/50 transition-colors enabled:hover:bg-white/[0.06] enabled:hover:text-white/90 disabled:cursor-not-allowed disabled:opacity-30"
              >
                <Download size={11} /> EXPORT
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!canDelete) { addToast('You lack permission to delete accounts', 'error'); return }
                  if (!window.confirm(`Delete ${selected.size} accounts? This cannot be undone.`)) return
                  const names = accounts.filter(a => selected.has(a.id)).map(a => a.handle)
                  remove([...selected])
                  logAudit({ actor: actorEmp.name, action: 'account.deleted', target: `${names.length} accounts`, detail: names.join(', '), result: 'success' })
                  addToast(`${selected.size} accounts deleted`, 'success')
                  setSelected(new Set())
                }}
                disabled={!canDelete}
                title={canDelete ? 'Delete selected' : 'Requires delete permission'}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[9px] uppercase tracking-widest text-status-error transition-colors enabled:hover:bg-status-error/10 disabled:cursor-not-allowed disabled:opacity-30"
              >
                <Trash2 size={11} /> DELETE
              </button>
              <div className="h-4 w-px bg-white/[0.08]" />
              <button
                onClick={() => { setSelected(new Set()); setStatusMenuOpen(false) }}
                aria-label="Clear selection"
                className="flex h-6 w-6 items-center justify-center text-white/30 transition-colors hover:bg-white/[0.08] hover:text-white/70"
              >
                <X size={12} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Drawer + modals */}
      <AnimatePresence>
        {drawerAcc && modal !== 'edit' && (
          <AccountDrawer
            key="account-drawer"
            account={drawerAcc}
            onClose={() => setDrawerId(null)}
            onEdit={() => setModal('edit')}
          />
        )}
        {modal === 'add' && (
          <AccountModal key="add" initial={null} groups={fleetGroups} owners={teamNames} canRevealPw={canRevealPw} canRevealRecovery={canRevealRecovery} onClose={() => setModal(null)} />
        )}
        {modal === 'edit' && editAcc && (
          <AccountModal key={'edit-' + editAcc.id} initial={editAcc} groups={fleetGroups} owners={teamNames} canRevealPw={canRevealPw} canRevealRecovery={canRevealRecovery} onClose={() => setModal(null)} />
        )}
        {modal === 'import' && <ImportModal key="import" onClose={() => setModal(null)} />}
      </AnimatePresence>
    </div>
  )
}

/** supabase-mode → metadata-only real account_records; demo/me-mode → legacy local store. */
export function AccountsView() {
  return SUPABASE_MODE ? <SupabaseAccountsView /> : <DemoAccountsView />
}
