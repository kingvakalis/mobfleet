import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, RotateCcw, Save, Gauge, Bell, Building2, Palette, PanelLeft, Anchor, Mail, SlidersHorizontal, LogOut } from 'lucide-react'
import { EXPO_OUT } from '@/lib/motion'
import { THEMES, ACCENTS, appearanceStyle, type ThemeId, type AccentId } from '@/lib/themes'
import {
  useSettings, DEFAULT_SETTINGS,
  type WorkspaceSettings, type PerformanceMode, type MotionPref,
  type SurfaceStyle, type BackgroundIntensity, type Density, type SidebarMode,
} from '@/state/settings-store'
import { useActingEmployee } from '@/lib/authorization/use-access'
import { useAuth } from '@/contexts/AuthContext'
import { SignOutButton } from '@/components/auth/sign-out-button'
import { can } from '@/lib/authorization'
import { logAudit } from '@/services/audit'
import { Section, Field, Toggle } from '@/components/settings/settings-primitives'
import { EmailSettings } from '@/components/settings/email-settings'
import { canAccessEmailSettings } from '@/lib/email/access'
import { AccessDenied } from '@/components/access/Can'

/**
 * Workspace settings. Every control here is consumed by real app logic:
 *  - theme/accent/surface/density   → global CSS tokens (lib/themes.ts)
 *  - backgroundIntensity/motion     → ambient canvas + transitions + tilt
 *  - performanceMode                → 3D DPR + decorative rendering cap
 *  - stream defaults                → phone-control initial slider state
 *  - stabilizePhone                 → phone-control body motion
 *  - confirmDestructive             → reboot / retire confirmation prompts
 *  - activityNotifications          → live activity feed default state
 *  - sidebarMode                    → app shell layout
 * Persistence is local (documented backend integration point in settings-store).
 */

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof WorkspaceSettings)[]

/** Generic option pill row. */
function Pills<T extends string>({ value, options, onChange, ariaLabel }: {
  value: T
  options: { id: T; label: string; hint?: string }[]
  onChange: (v: T) => void
  ariaLabel: string
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
      {options.map(o => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          title={o.hint}
          onClick={() => onChange(o.id)}
          className={[
            'border px-2.5 py-1.5 text-[10px] uppercase tracking-wider transition-colors',
            value === o.id
              ? 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]'
              : 'border-line text-white/45 hover:bg-hover hover:text-white/75',
          ].join(' ')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Live preview — renders shared primitives inside a scoped token override. */
function AppearancePreview({ draft }: { draft: WorkspaceSettings }) {
  return (
    <div
      className="overflow-hidden rounded-card border"
      style={{
        ...appearanceStyle(draft),
        background: 'var(--bg-base)',
        borderColor: 'var(--border-bright)',
      }}
    >
      <div className="flex">
        {/* mini sidebar */}
        <div className="w-[86px] shrink-0 border-r p-2" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
          {['Fleet', 'Phones', 'Team'].map((l, i) => (
            <div
              key={l}
              className="mb-1 rounded-sm px-1.5 py-1 text-[8px] uppercase tracking-wider"
              style={i === 0
                ? { background: 'var(--accent-soft)', color: 'var(--accent-text)', borderLeft: '2px solid var(--accent)' }
                : { color: 'rgba(255,255,255,0.35)' }}
            >
              {l}
            </div>
          ))}
        </div>
        {/* mini content */}
        <div className="flex-1 space-y-2 p-3">
          <div className="rounded-md border p-2.5" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-white/75">Device card</span>
              <span className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[8px]" style={{ background: 'rgba(52,211,153,0.12)', color: '#34d399' }}>
                <span className="h-1 w-1 rounded-full" style={{ background: '#34d399' }} /> ONLINE
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="rounded-sm px-2 py-1 text-[9px]" style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent-border)', color: 'var(--accent-text)' }}>
                Primary action
              </span>
              <span className="rounded-sm border px-2 py-1 text-[9px] text-white/45" style={{ borderColor: 'var(--border)' }}>
                Ghost
              </span>
            </div>
          </div>
          {/* mini table row + device node */}
          <div className="flex items-center gap-2">
            <div className="flex-1 rounded-md border" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between border-b px-2 py-1" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}>
                <span className="text-[8px] uppercase tracking-wider text-white/30">Name</span>
                <span className="text-[8px] uppercase tracking-wider text-white/30">Status</span>
              </div>
              <div className="flex items-center justify-between px-2 py-1.5" style={{ background: 'var(--bg-hover)' }}>
                <span className="text-[9px] text-white/70">CAROLINA 1</span>
                <span className="text-[8px]" style={{ color: '#4fc3f7' }}>BUSY</span>
              </div>
            </div>
            <div
              className="h-12 w-7 shrink-0 rounded-[5px] p-[2px]"
              style={{ background: 'linear-gradient(150deg,#48484c,#1c1c1f 30%,#0c0c0e 65%,#313135)', boxShadow: '0 0 0 1.5px var(--accent)' }}
            >
              <div className="h-full w-full rounded-[3.5px] bg-pure-black" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

type SettingsTab = 'general' | 'email'

export function SettingsView() {
  const store = useSettings()
  const { employee, member } = useActingEmployee()
  // Per-section edit permissions.
  const canWorkspace  = can(member, 'settings.edit_workspace')
  const canAppearance = can(member, 'settings.edit_appearance')
  const canDevice     = can(member, 'settings.edit_device')
  const canSecurity   = can(member, 'settings.edit_security')
  const canEditAny    = canWorkspace || canAppearance || canDevice || canSecurity
  // Email settings are Owner/Admin-only (mirrors the team-view access pattern).
  const canEmail = canAccessEmailSettings(member)
  const [tab, setTab] = useState<SettingsTab>('general')
  const [draft, setDraft] = useState<WorkspaceSettings>(() => {
    const d = {} as Record<string, unknown>
    for (const k of SETTING_KEYS) d[k] = store[k]
    return d as unknown as WorkspaceSettings
  })
  const [saved, setSaved] = useState(false)
  const { enabled: authEnabled, user } = useAuth()

  // Derive the visible tab so access revoked mid-session (e.g. the dev "acting
  // as" switch dropping to a non-admin role) instantly falls back to General —
  // without a setState-in-effect and without ever flashing the restricted page.
  const activeTab: SettingsTab = tab === 'email' && !canEmail ? 'general' : tab

  const TABS = [
    { id: 'general' as const, label: 'General', icon: SlidersHorizontal },
    ...(canEmail ? [{ id: 'email' as const, label: 'Email', icon: Mail }] : []),
  ]

  // Roving-tabindex keyboard nav for the section tablist (WAI-ARIA tabs).
  const tabRefs = useRef<Record<SettingsTab, HTMLButtonElement | null>>({ general: null, email: null })
  const onTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const ids = TABS.map((t) => t.id)
    const idx = ids.indexOf(activeTab)
    let next: number
    if (e.key === 'ArrowRight') next = (idx + 1) % ids.length
    else if (e.key === 'ArrowLeft') next = (idx - 1 + ids.length) % ids.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = ids.length - 1
    else return
    e.preventDefault()
    const id = ids[next]
    setTab(id)
    tabRefs.current[id]?.focus()
  }

  const dirty = SETTING_KEYS.some((k) => draft[k] !== store[k])
  const valid =
    draft.workspaceName.trim().length > 0 &&
    draft.defaultStreamQuality >= 0 && draft.defaultStreamQuality <= 30 &&
    draft.defaultStreamFps >= 5 && draft.defaultStreamFps <= 30

  useEffect(() => {
    if (!saved) return
    const id = setTimeout(() => setSaved(false), 1800)
    return () => clearTimeout(id)
  }, [saved])

  const set = <K extends keyof WorkspaceSettings>(k: K, v: WorkspaceSettings[K]) =>
    setDraft(d => ({ ...d, [k]: v }))

  const save = () => {
    if (!valid || !canEditAny) return
    store.update(draft)
    const changed = SETTING_KEYS.filter((k) => draft[k] !== store[k])
    logAudit({ actor: employee.name, action: 'settings.changed', target: 'Workspace settings', detail: changed.join(', '), result: 'success' })
    setSaved(true)
  }

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <div>
          <p className="mb-1 text-[9px] uppercase tracking-wide text-white/30">Workspace</p>
          <h1 className="text-lg font-bold uppercase tracking-wide text-white">Settings</h1>
        </div>
        <div className="flex items-center gap-2">
          {/* Sub-navigation. The Email tab only renders for Owner/Admin. */}
          <div role="tablist" aria-label="Settings sections" onKeyDown={onTabKeyDown} className="flex items-center gap-1 rounded-lg border border-line bg-black/40 p-1">
            {TABS.map(({ id, label, icon: Icon }) => {
              const active = activeTab === id
              return (
                <button
                  key={id}
                  ref={(el) => { tabRefs.current[id] = el }}
                  type="button"
                  role="tab"
                  id={`settings-tab-${id}`}
                  aria-selected={active}
                  aria-controls={`settings-panel-${id}`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => setTab(id)}
                  className={[
                    'flex items-center gap-1.5 rounded px-3 py-1.5 text-[9px] uppercase tracking-wide transition-colors',
                    active ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'text-white/40 hover:text-white/70',
                  ].join(' ')}
                >
                  <Icon size={11} /> {label}
                </button>
              )
            })}
          </div>
          {/* Workspace settings use an explicit draft+Save; email prefs persist
              immediately, so the Save controls only apply to the General tab. */}
          {activeTab === 'general' && (
            <>
              <AnimatePresence>
                {dirty && (
                  <motion.span
                    initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                    className="text-[10px] uppercase tracking-wider text-amber-400"
                  >
                    Unsaved changes
                  </motion.span>
                )}
              </AnimatePresence>
              <button
                onClick={() => setDraft({ ...DEFAULT_SETTINGS })}
                disabled={!canEditAny}
                title={canEditAny ? undefined : 'You do not have permission to edit settings'}
                className="btn-ghost flex h-8 items-center gap-1.5 px-3 text-[10px] uppercase tracking-wide disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RotateCcw size={11} /> Defaults
              </button>
              <button
                onClick={save}
                disabled={!dirty || !valid || !canEditAny}
                title={!canEditAny ? 'You do not have permission to edit settings' : !valid ? 'Fix validation errors first' : undefined}
                className="btn-accent flex h-8 items-center gap-1.5 px-4 text-[10px] uppercase tracking-wide disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saved ? <Check size={12} /> : <Save size={12} />} {saved ? 'Saved' : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>

      {activeTab === 'email' ? (
        <div id="settings-panel-email" role="tabpanel" aria-labelledby="settings-tab-email" className="flex-1 overflow-y-auto p-6">
          {/* Defensive guard: the tab is hidden for unauthorized roles, and the
              derived activeTab never resolves to 'email' without Owner/Admin
              access — so the page never renders for an unauthorized user. */}
          {canEmail ? <EmailSettings /> : <AccessDenied onBack={() => setTab('general')} />}
        </div>
      ) : (
      <div id="settings-panel-general" role="tabpanel" aria-labelledby="settings-tab-general" className="flex-1 overflow-y-auto p-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EXPO_OUT }}
          className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-4 lg:grid-cols-2"
        >
          {/* ── Appearance ─────────────────────────────────────────────────── */}
          <Section icon={Palette} title="Appearance" desc="Theme, accent, surfaces, and density — applied across the entire console." wide locked={!canAppearance}>
            <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
              <div className="space-y-4">
                <div>
                  <div className="mb-1.5 text-[11px] text-white/60">Theme preset</div>
                  <div role="radiogroup" aria-label="Theme preset" className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
                    {(Object.keys(THEMES) as ThemeId[]).map(id => {
                      const t = THEMES[id]
                      const on = draft.theme === id
                      return (
                        <button
                          key={id}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => set('theme', id)}
                          className={[
                            'border p-2 text-left transition-colors',
                            on ? 'border-[var(--accent-border)] bg-[var(--accent-soft)]' : 'border-line hover:bg-hover',
                          ].join(' ')}
                        >
                          <div className="mb-1.5 flex gap-1">
                            <span className="h-3.5 w-3.5 rounded-sm border border-white/15" style={{ background: t.vars.base }} />
                            <span className="h-3.5 w-3.5 rounded-sm border border-white/15" style={{ background: t.vars.elevated }} />
                            <span className="h-3.5 w-3.5 rounded-sm border border-white/15" style={{ background: t.vars.hover }} />
                          </div>
                          <div className={`text-[10px] uppercase tracking-wider ${on ? 'text-[var(--accent-text)]' : 'text-white/65'}`}>{t.label}</div>
                          <div className="mt-0.5 text-[9px] leading-snug text-white/30">{t.desc}</div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 text-[11px] text-white/60">Accent</div>
                  <div role="radiogroup" aria-label="Accent color" className="flex gap-1.5">
                    {(Object.keys(ACCENTS) as AccentId[]).map(id => {
                      const a = ACCENTS[id]
                      const on = draft.accent === id
                      return (
                        <button
                          key={id}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          title={a.label}
                          onClick={() => set('accent', id)}
                          className={[
                            'flex items-center gap-2 border px-2.5 py-1.5 transition-colors',
                            on ? 'border-[var(--accent-border)] bg-[var(--accent-soft)]' : 'border-line hover:bg-hover',
                          ].join(' ')}
                        >
                          <span className="h-3 w-3 rounded-full" style={{ background: a.vars.accent }} />
                          <span className={`text-[9px] uppercase tracking-wider ${on ? 'text-[var(--accent-text)]' : 'text-white/45'}`}>{a.label}</span>
                        </button>
                      )
                    })}
                  </div>
                  <p className="mt-1.5 text-[9px] text-white/25">Status colors stay semantic — green online, amber warning, red error.</p>
                </div>

                <Field label="Surface style">
                  <Pills
                    ariaLabel="Surface style"
                    value={draft.surface}
                    onChange={(v: SurfaceStyle) => set('surface', v)}
                    options={[
                      { id: 'flat', label: 'Flat' },
                      { id: 'soft', label: 'Soft depth' },
                      { id: 'glass', label: 'Glass', hint: 'Restrained translucency on cards' },
                    ]}
                  />
                </Field>
                <Field label="Background intensity" hint="Grid, ambient light, grain, and particles">
                  <Pills
                    ariaLabel="Background intensity"
                    value={draft.backgroundIntensity}
                    onChange={(v: BackgroundIntensity) => set('backgroundIntensity', v)}
                    options={[
                      { id: 'off', label: 'Off' },
                      { id: 'minimal', label: 'Minimal' },
                      { id: 'balanced', label: 'Balanced' },
                      { id: 'atmospheric', label: 'Atmospheric' },
                    ]}
                  />
                </Field>
                <Field label="Motion" hint="Transitions, tilt, ambient and graph easing — OS reduced-motion is always respected">
                  <Pills
                    ariaLabel="Motion preference"
                    value={draft.motion}
                    onChange={(v: MotionPref) => set('motion', v)}
                    options={[
                      { id: 'full', label: 'Full' },
                      { id: 'balanced', label: 'Balanced' },
                      { id: 'reduced', label: 'Reduced' },
                      { id: 'off', label: 'Off' },
                    ]}
                  />
                </Field>
                <Field label="Interface density">
                  <Pills
                    ariaLabel="Interface density"
                    value={draft.density}
                    onChange={(v: Density) => set('density', v)}
                    options={[
                      { id: 'comfortable', label: 'Comfortable' },
                      { id: 'compact', label: 'Compact' },
                      { id: 'dense', label: 'Dense' },
                    ]}
                  />
                </Field>
                <Field label="Sidebar" hint="Ctrl+B toggles; the rail expands fully on hover and shrinks back">
                  <Pills
                    ariaLabel="Sidebar mode"
                    value={draft.sidebarMode}
                    onChange={(v: SidebarMode) => set('sidebarMode', v)}
                    options={[
                      { id: 'expanded', label: 'Expanded' },
                      { id: 'collapsed', label: 'Rail' },
                    ]}
                  />
                </Field>
              </div>

              {/* live preview */}
              <div>
                <div className="mb-1.5 text-[11px] text-white/60">Preview</div>
                <AppearancePreview draft={draft} />
                <p className="mt-2 text-[9px] leading-relaxed text-white/25">
                  Live preview of the draft — nothing applies to the app until you save.
                </p>
              </div>
            </div>
          </Section>

          <Section icon={Building2} title="Workspace" desc="Identity shown across the console." locked={!canWorkspace}>
            <Field label="Workspace name">
              <input
                aria-label="Workspace name"
                value={draft.workspaceName}
                onChange={e => set('workspaceName', e.target.value)}
                className="h-8 w-44 rounded-control border border-line bg-elevated px-2.5 text-[12px] text-fg outline-none transition-colors focus:border-[var(--accent-border)]"
              />
            </Field>
            <Field label="Operator name" hint="Used to attribute actions in the activity feed">
              <input
                aria-label="Operator name"
                value={draft.operatorName}
                onChange={e => set('operatorName', e.target.value)}
                className="h-8 w-44 rounded-control border border-line bg-elevated px-2.5 text-[12px] text-fg outline-none transition-colors focus:border-[var(--accent-border)]"
              />
            </Field>
            <Field label="Performance mode" hint="Caps 3D resolution and decorative rendering">
              <Pills
                ariaLabel="Performance mode"
                value={draft.performanceMode}
                onChange={(v: PerformanceMode) => set('performanceMode', v)}
                options={[
                  { id: 'full', label: 'Full' },
                  { id: 'balanced', label: 'Balanced' },
                  { id: 'reduced', label: 'Reduced' },
                ]}
              />
            </Field>
          </Section>

          {/* ── Account ───────────────────────────────────────────────────────
              Only with real auth (the mock/demo build has no session). Never
              `locked` — signing out must always be available to the signed-in user. */}
          {authEnabled && (
            <Section icon={LogOut} title="Account" desc="The signed-in user and session.">
              <Field label="Signed in as">
                <span className="mono text-[12px] text-fg-secondary">{user?.email ?? '—'}</span>
              </Field>
              <Field label="Session" hint="End your session and return to the login screen">
                <SignOutButton variant="settings" />
              </Field>
            </Section>
          )}

          <Section icon={Gauge} title="Device Control" desc="Defaults applied when opening a phone-control session." locked={!canDevice}>
            <Field label="Default stream quality" hint="0–30">
              <input
                aria-label="Default stream quality (0 to 30)"
                type="number" min={0} max={30}
                value={draft.defaultStreamQuality}
                onChange={e => set('defaultStreamQuality', Number(e.target.value))}
                className={[
                  'h-8 w-20 rounded-control border bg-elevated px-2.5 text-[12px] text-fg outline-none transition-colors',
                  draft.defaultStreamQuality >= 0 && draft.defaultStreamQuality <= 100 ? 'border-line focus:border-[var(--accent-border)]' : 'border-status-error',
                ].join(' ')}
              />
            </Field>
            <Field label="Default stream FPS" hint="5–30">
              <input
                aria-label="Default stream FPS (5 to 30)"
                type="number" min={5} max={30}
                value={draft.defaultStreamFps}
                onChange={e => set('defaultStreamFps', Number(e.target.value))}
                className={[
                  'h-8 w-20 rounded-control border bg-elevated px-2.5 text-[12px] text-fg outline-none transition-colors',
                  draft.defaultStreamFps >= 5 && draft.defaultStreamFps <= 30 ? 'border-line focus:border-[var(--accent-border)]' : 'border-status-error',
                ].join(' ')}
              />
            </Field>
            <Field label="Stabilize phone" hint="Stops decorative phone-body tilt on the control page (screen gestures stay active)">
              <span className="flex items-center gap-2">
                <Anchor size={12} className="text-white/30" />
                <Toggle on={draft.stabilizePhone} onChange={v => set('stabilizePhone', v)} label="Stabilize phone" />
              </span>
            </Field>
            <Field label="Confirm destructive actions" hint="Ask before reboot and retire">
              <Toggle on={draft.confirmDestructive} onChange={v => set('confirmDestructive', v)} label="Confirm destructive actions" />
            </Field>
          </Section>

          <Section icon={Bell} title="Notifications" desc="Live event surfacing across the console." locked={!canAppearance}>
            <Field label="Live activity feed" hint="Stream fleet events into the Fleet activity panel">
              <Toggle on={draft.activityNotifications} onChange={v => set('activityNotifications', v)} label="Live activity feed" />
            </Field>
            <p className="border-t border-line pt-3 text-[10px] leading-relaxed text-white/25">
              Settings persist in this browser. Server-side workspace settings are a
              documented backend integration point (state/settings-store.ts).
            </p>
          </Section>

          <Section icon={PanelLeft} title="Shortcuts" desc="Keyboard access to layout controls." locked={!canAppearance}>
            <div className="space-y-2">
              {[
                ['Ctrl / Cmd + B', 'Toggle sidebar (or open auto-hidden menu)'],
                ['Ctrl / Cmd + K', 'Command palette'],
                ['Escape', 'Clear fleet selection / close panels'],
                ['Enter', 'Open control for the selected fleet phone'],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between">
                  <span className="rounded-control border border-line bg-black/40 px-2 py-1 text-[10px] text-white/60">{k}</span>
                  <span className="text-[11px] text-white/40">{v}</span>
                </div>
              ))}
            </div>
          </Section>
        </motion.div>
      </div>
      )}
    </div>
  )
}
