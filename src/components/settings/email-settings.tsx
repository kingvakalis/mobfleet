import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Mail, Eye, Send, Lock } from 'lucide-react'
import { EXPO_OUT, staggerContainer, fadeRise } from '@/lib/motion'
import { Section, Field, Toggle } from '@/components/settings/settings-primitives'
import { useEmailSettings } from '@/state/email-settings-store'
import type { EmailPreferences } from '@/lib/email/preferences'
import { renderPreview, type EmailPreviewType } from '@/lib/email/preview-templates'
import {
  ApiError,
  buildEmailSettingsUpdate,
  fetchEmailSettings,
  saveEmailSettings,
} from '@/services/email-settings'

/**
 * Email Settings page — local UI preferences + a safe, sandboxed preview of the
 * workspace transactional emails. Rendered as the "Email" tab inside Settings,
 * which restricts access to Owner/Admin (see settings-view.tsx).
 */

const TRANSACTIONAL_TOGGLES: { key: keyof EmailPreferences; label: string; hint: string }[] = [
  { key: 'teamInvitesEnabled', label: 'Team Invites', hint: 'Send an email when an employee is invited to join the workspace.' },
  { key: 'passwordResetEnabled', label: 'Password Reset', hint: 'Send password-reset instructions when a user requests account recovery.' },
  { key: 'welcomeEmailEnabled', label: 'Welcome Email', hint: 'Send a welcome email after a new account completes signup.' },
]

const PREVIEW_TABS: { id: EmailPreviewType; label: string }[] = [
  { id: 'invite', label: 'Invite' },
  { id: 'reset', label: 'Reset' },
  { id: 'welcome', label: 'Welcome' },
]

const PREVIEW_TITLES: Record<EmailPreviewType, string> = {
  invite: 'Team invitation email preview',
  reset: 'Password reset email preview',
  welcome: 'Welcome email preview',
}

function TransactionalEmailSettings() {
  // Subscribing to the whole store keeps each toggle in sync; updates persist
  // immediately (no Save step), matching the BACKEND INTEGRATION POINT contract.
  const prefs = useEmailSettings()
  return (
    <Section icon={Mail} title="Transactional Emails" desc="Choose which automated emails MOBFLEET sends to your team.">
      {TRANSACTIONAL_TOGGLES.map((t) => (
        <Field key={t.key} label={t.label} hint={t.hint}>
          <Toggle on={prefs[t.key]} onChange={(v) => prefs.setPreference(t.key, v)} label={t.label} />
        </Field>
      ))}
      {/* These toggles are local-only: there is no backend field for them yet, so
          they do NOT change live email delivery. (Sender Config below is saved to
          the server.) */}
      <p className="border-t border-line pt-3 text-[10px] leading-relaxed text-white/25">
        Saved in this browser only — these toggles don’t yet change live email delivery. Sender Config below is saved to the server.
      </p>
    </Section>
  )
}

function EmailPreviewTabs({ value, onChange }: { value: EmailPreviewType; onChange: (v: EmailPreviewType) => void }) {
  const refs = useRef<Record<EmailPreviewType, HTMLButtonElement | null>>({ invite: null, reset: null, welcome: null })

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const idx = PREVIEW_TABS.findIndex((t) => t.id === value)
    let next: number
    if (e.key === 'ArrowRight') next = (idx + 1) % PREVIEW_TABS.length
    else if (e.key === 'ArrowLeft') next = (idx - 1 + PREVIEW_TABS.length) % PREVIEW_TABS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = PREVIEW_TABS.length - 1
    else return
    e.preventDefault()
    const id = PREVIEW_TABS[next].id
    onChange(id)
    refs.current[id]?.focus()
  }

  return (
    <div role="tablist" aria-label="Email template preview" onKeyDown={onKeyDown} className="flex gap-1 overflow-x-auto border-b border-line">
      {PREVIEW_TABS.map((t) => {
        const active = t.id === value
        return (
          <button
            key={t.id}
            ref={(el) => { refs.current[t.id] = el }}
            type="button"
            role="tab"
            id={`email-preview-tab-${t.id}`}
            aria-selected={active}
            aria-controls={`email-preview-panel-${t.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={[
              'relative mono whitespace-nowrap px-3 py-2 text-[10px] uppercase tracking-[0.12em] transition-colors',
              active ? 'text-[var(--accent-text)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
            ].join(' ')}
          >
            {t.label}
            {active && (
              <motion.span
                layoutId="email-preview-underline"
                className="absolute -bottom-px left-2 right-2 h-0.5"
                style={{ background: 'var(--accent)' }}
                transition={{ duration: 0.2, ease: EXPO_OUT }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}

function EmailPreviewFrame({ type }: { type: EmailPreviewType }) {
  const reduce = useReducedMotion()
  const result = useMemo<{ html: string } | { error: true }>(() => {
    try {
      const { html } = renderPreview(type)
      if (!html || typeof html !== 'string') return { error: true }
      return { html }
    } catch {
      return { error: true }
    }
  }, [type])

  return (
    <div
      id={`email-preview-panel-${type}`}
      role="tabpanel"
      aria-labelledby={`email-preview-tab-${type}`}
      className="card-surface overflow-hidden rounded-card border border-line bg-[var(--bg-elevated)] p-3 sm:p-4"
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={type}
          initial={{ opacity: 0, y: reduce ? 0 : 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduce ? 0 : -6 }}
          transition={{ duration: 0.2, ease: EXPO_OUT }}
        >
          {'error' in result ? (
            <div className="flex h-[560px] items-center justify-center px-6 text-center">
              <p className="mono text-[11px] text-[var(--text-muted)]">Unable to render this email preview.</p>
            </div>
          ) : (
            // Fully sandboxed (no allow-scripts / no allow-same-origin): scripts
            // can't run and CTA links can't navigate the host app.
            <iframe
              title={PREVIEW_TITLES[type]}
              srcDoc={result.html}
              sandbox=""
              className="h-[620px] w-full rounded-control border-0 bg-[#1a1f2e]"
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function EmailPreview() {
  const [type, setType] = useState<EmailPreviewType>('invite')
  return (
    <Section icon={Eye} title="Email Preview" desc="Preview the transactional emails your workspace sends. Links in the preview are inert.">
      <div className="space-y-3">
        <EmailPreviewTabs value={type} onChange={setType} />
        <EmailPreviewFrame type={type} />
      </div>
    </Section>
  )
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SENDER_INPUT =
  'mono h-8 w-56 max-w-[60vw] rounded-control border border-line bg-elevated px-2.5 text-[12px] text-fg outline-none transition-colors focus:border-[var(--accent-border)]'

/**
 * Editable, server-backed sender configuration (GET/POST /v1/settings/email).
 *
 * Server state is authoritative for sender name/email + whether a Resend key is
 * configured (and its last 4). The full key is NEVER prefilled, persisted, or
 * logged: the password input starts blank; leaving it blank preserves the stored
 * key; entering a new value rotates it. The masked status is shown as a hint,
 * never inside the editable value.
 */
function SenderConfiguration() {
  const [senderName, setSenderName] = useState('')
  const [senderEmail, setSenderEmail] = useState('')
  const [newApiKey, setNewApiKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [last4, setLast4] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  // A late GET response must not clobber edits the user has already started.
  const touched = useRef(false)

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    fetchEmailSettings()
      .then((res) => {
        if (cancelled || touched.current) return
        if (res.settings) {
          setSenderName(res.settings.senderName)
          setSenderEmail(res.settings.senderEmail)
          setHasKey(res.settings.hasResendApiKey)
          setLast4(res.settings.resendApiKeyLast4)
        } else {
          setSenderName(res.defaults?.senderName ?? '')
          setSenderEmail(res.defaults?.senderEmail ?? '')
          setHasKey(false)
          setLast4(null)
        }
        setError(null)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof ApiError && e.status === 403
          ? 'You do not have permission to view email settings.'
          : 'Could not load email settings.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const edit = (fn: () => void) => { touched.current = true; setSaved(false); fn() }
  const emailValid = EMAIL_RE.test(senderEmail.trim())
  const canSave = !saving && senderName.trim().length > 0 && emailValid

  const onSave = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await saveEmailSettings(buildEmailSettingsUpdate({ senderName, senderEmail, newApiKey }))
      setSenderName(res.settings.senderName)
      setSenderEmail(res.settings.senderEmail)
      setHasKey(res.settings.hasResendApiKey)
      setLast4(res.settings.resendApiKeyLast4)
      setNewApiKey('') // clear the new-key input after a successful save
      touched.current = false
      setSaved(true)
    } catch (e) {
      // Keep the user's unsaved values on failure.
      setError(e instanceof ApiError && e.status === 403
        ? 'You do not have permission to change email settings.'
        : e instanceof Error ? e.message : 'Could not save email settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section icon={Send} title="Sender Config" desc="The From identity and Resend key this team sends transactional email with.">
      {loading ? (
        <p className="mono text-[11px] text-white/40">Loading…</p>
      ) : (
        <>
          <Field label="Sender Name" hint="Shown as the From name on outgoing email.">
            <input
              aria-label="Sender name"
              value={senderName}
              onChange={(e) => edit(() => setSenderName(e.target.value))}
              className={SENDER_INPUT}
            />
          </Field>
          <Field label="Sender Email" hint="The From address for transactional email.">
            <input
              aria-label="Sender email"
              type="email"
              value={senderEmail}
              onChange={(e) => edit(() => setSenderEmail(e.target.value))}
              className={[SENDER_INPUT, senderEmail.trim().length === 0 || emailValid ? '' : 'border-status-error'].join(' ')}
            />
          </Field>
          <Field
            label="Resend API Key"
            hint={hasKey && last4 ? `Configured — ending in ${last4}. Leave blank to keep it.` : 'Enter a Resend API key to enable sending for this team.'}
          >
            <input
              aria-label="Resend API key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={hasKey ? '••••••••' : 're_…'}
              value={newApiKey}
              onChange={(e) => edit(() => setNewApiKey(e.target.value))}
              className={SENDER_INPUT}
            />
          </Field>
          <Field label="Provider" hint="Transactional emails are delivered through Resend.">
            <span aria-readonly="true" className="mono inline-flex items-center gap-1.5 rounded-control border border-line bg-black/40 px-2.5 py-1 text-[11px] text-white/70">
              <Lock size={10} className="text-white/30" aria-hidden="true" /> Resend
            </span>
          </Field>

          {error && <p role="alert" className="text-[11px] leading-relaxed text-status-error">{error}</p>}

          <div className="flex items-center gap-3 border-t border-line pt-3">
            <button
              type="button"
              onClick={onSave}
              disabled={!canSave}
              className="btn-accent mono flex h-8 items-center gap-1.5 px-4 text-[10px] uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <AnimatePresence>
              {saved && (
                <motion.span
                  initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                  className="mono text-[10px] uppercase tracking-wider text-[var(--accent-text)]"
                >
                  Email settings saved.
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </>
      )}
    </Section>
  )
}

export function EmailSettings() {
  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-4 lg:grid-cols-2"
    >
      {/* Transactional + Sender sit at normal Settings width; the preview spans
          the full grid as the dominant, wide section (mirrors the General grid). */}
      <motion.div variants={fadeRise}>
        <TransactionalEmailSettings />
      </motion.div>
      <motion.div variants={fadeRise}>
        <SenderConfiguration />
      </motion.div>
      <motion.div variants={fadeRise} className="lg:col-span-2">
        <EmailPreview />
      </motion.div>
    </motion.div>
  )
}
