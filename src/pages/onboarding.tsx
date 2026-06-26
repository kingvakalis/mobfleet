import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Check, Rocket } from 'lucide-react'
import { EXPO_OUT } from '@/lib/motion'
import { Spinner } from '@/components/ui/spinner'
import { BrandLogo } from '@/components/brand/brand-logo'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useAuthz } from '@/contexts/AuthzContext'
import { useTeamContext } from '@/contexts/TeamContext'
import { useToastStore } from '@/state/toast-store'
import { AUTH_SOURCE } from '@/auth/auth-source'
import { ApiError, createOnboardingTeam } from '@/services/me-client'
import { ONBOARDING_PROGRESS_KEY as PROGRESS_KEY, clearOnboardingProgress } from '@/contexts/onboarding'

/**
 * Discovery-style onboarding for workspace creators (the OnboardingGate routes
 * first-run owners here; invited members skip it). Each step is one full-screen
 * question with a progress bar. Progress is stashed in localStorage so a refresh
 * or navigation resumes where you left off. On finish the answers persist to
 * onboarding_responses and the user is marked onboarded.
 */

const TOTAL_STEPS = 7

interface Answers {
  fullName: string
  companyName: string
  goal: string
  goalOther: string
  obstacles: string[]
  obstaclesOther: string
  pastExperience: string
  pastExperienceOther: string
  scale: string
  referral: string
  referralOther: string
  conversions: string[]
  conversionsOther: string
}

const EMPTY: Answers = {
  fullName: '', companyName: '', goal: '', goalOther: '', obstacles: [], obstaclesOther: '',
  pastExperience: '', pastExperienceOther: '', scale: '', referral: '', referralOther: '',
  conversions: [], conversionsOther: '',
}

interface Opt { key: string; label: string; icon?: string; sub?: string; hasText?: boolean }

const GOALS: Opt[] = [
  { key: 'scale_repost', icon: '📱', label: 'Scale content reposting across multiple accounts' },
  { key: 'grow_social', icon: '🚀', label: 'Grow Instagram/social accounts with automation' },
  { key: 'agency', icon: '🏢', label: "Manage phones for my agency's clients" },
  { key: 'phone_farm_biz', icon: '💰', label: 'Build a phone farm business and sell access' },
  { key: 'other', icon: '🔧', label: 'Other' },
]
const OBSTACLES: Opt[] = [
  { key: 'manual_time', icon: '⏰', label: 'Managing everything manually takes too much time' },
  { key: 'bans', icon: '📵', label: 'Phones keep getting banned or restricted' },
  { key: 'no_automation', icon: '🔄', label: 'No reliable automation — everything is manual' },
  { key: 'expensive', icon: '💸', label: 'Current solutions are too expensive' },
  { key: 'starting', icon: '🤷', label: "I'm just getting started — haven't tried anything yet" },
  { key: 'other', label: 'Other' },
]
const PAST: Opt[] = [
  { key: 'cloud_rental', label: 'Ali Remotes / iPhoneMirror / similar cloud phone rental' },
  { key: 'own_setup', label: 'Built my own setup (Mac Mini, USB hubs, etc.)' },
  { key: 'other_saas', label: 'Used another SaaS platform', hasText: true },
  { key: 'first_time', label: 'No, this is my first time' },
]
const SCALE: Opt[] = [
  { key: '1-5', label: '1–5', sub: 'Getting started' },
  { key: '6-15', label: '6–15', sub: 'Growing operation' },
  { key: '16-50', label: '16–50', sub: 'Scaling up' },
  { key: '50+', label: '50+', sub: 'Enterprise fleet' },
]
const REFERRAL: Opt[] = [
  { key: 'friend', label: 'A friend or colleague recommended it' },
  { key: 'social', label: 'Found it on social media (Instagram, Twitter, TikTok)' },
  { key: 'youtube', label: 'YouTube video or review' },
  { key: 'google', label: 'Google search' },
  { key: 'community', label: 'Facebook/Reddit community or forum' },
  { key: 'other', label: 'Other' },
]
const CONVERSIONS: Opt[] = [
  { key: 'pricing', icon: '🎯', label: 'The pricing made sense for what I get' },
  { key: 'trust', icon: '🛡️', label: 'I trust the team / brand behind it' },
  { key: 'now', icon: '⚡', label: "I needed a solution NOW — couldn't wait" },
  { key: 'features', icon: '🔧', label: 'The features matched exactly what I was looking for' },
  { key: 'demo', icon: '📹', label: 'A demo or video convinced me' },
  { key: 'vouched', icon: '💬', label: 'Someone I trust vouched for it' },
  { key: 'other', label: 'Other' },
]

const labelFor = (opts: Opt[], key: string) => opts.find((o) => o.key === key)?.label ?? key

export function OnboardingPage() {
  const navigate = useNavigate()
  const { enabled, loading, session, user } = useAuth()
  const team = useTeamContext()
  const authz = useAuthz()
  const addToast = useToastStore((s) => s.addToast)

  // The gate routes no-team users here; provision their first workspace (deliberate,
  // idempotent, server-enforced by RLS + the owner-bootstrap trigger) before the
  // survey. One attempt, retryable on failure — never an infinite re-create loop.
  const provisionAttempted = useRef(false)
  // me-mode: a second, idempotent attempt creates the authoritative PRISMA team alongside
  // the Supabase one (see the dual-write effect below). Tracked separately so each retries
  // independently.
  const prismaAttempted = useRef(false)
  const [provisionError, setProvisionError] = useState<string | null>(null)
  const retryProvision = () => { provisionAttempted.current = false; prismaAttempted.current = false; setProvisionError(null) }

  // Resume from localStorage via lazy initializers, so progress is correct from
  // the first render (no setState-in-effect hydration pass).
  const [step, setStep] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(PROGRESS_KEY)
      if (raw) {
        const p = JSON.parse(raw) as { step?: number }
        if (typeof p.step === 'number') return Math.min(Math.max(p.step, 0), TOTAL_STEPS - 1)
      }
    } catch { /* ignore corrupt progress */ }
    return 0
  })
  const [a, setA] = useState<Answers>(() => {
    try {
      const raw = localStorage.getItem(PROGRESS_KEY)
      if (raw) {
        const p = JSON.parse(raw) as { answers?: Partial<Answers> }
        return { ...EMPTY, ...(p.answers ?? {}) }
      }
    } catch { /* ignore corrupt progress */ }
    return { ...EMPTY }
  })
  const [saving, setSaving] = useState(false)
  // Set the instant finish() begins, so the USER_UPDATED event from
  // updateUser({onboarded:true}) can't trip the onboarded-redirect guard and skip
  // the completion screen.
  const [done, setDone] = useState(false)

  // Pre-fill identity from auth/team once available (only fields still empty).
  useEffect(() => {
    const meta = (user?.user_metadata ?? {}) as { full_name?: string; name?: string }
    const nameGuess = meta.full_name ?? meta.name ?? ''
    const companyGuess = team.team?.name ?? ''
    if (!nameGuess && !companyGuess) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setA((prev) => ({ ...prev, fullName: prev.fullName || nameGuess, companyName: prev.companyName || companyGuess }))
  }, [user, team.team?.id, team.team?.name])

  // Persist progress on every change (but never the transient completion step).
  useEffect(() => {
    if (done || step >= TOTAL_STEPS) return
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify({ step, answers: a })) } catch { /* quota */ }
  }, [step, a, done])

  // Create the first workspace once membership has resolved to "no team". Guarded so
  // it fires exactly once; provisionTeam is itself idempotent (adopts an existing
  // team / a concurrent winner), so double-submits and StrictMode can't duplicate.
  useEffect(() => {
    if (!enabled || loading || !session) return
    if (team.loading || team.team || team.suspended) return
    if (provisionAttempted.current) return
    provisionAttempted.current = true
    void team.provisionTeam().then((res) => {
      if (res.error) { provisionAttempted.current = false; setProvisionError(res.error) }
    })
    // provisionTeam is a stable useCallback; team's other fields are listed explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, loading, session, team.loading, team.team, team.suspended, team.provisionTeam])

  // me-mode dual-write: once the user's OWN Supabase team exists (the data layer + the name
  // source), mint the matching authoritative PRISMA team so `GET /v1/me` flips from
  // onboardingRequired → ready. OWNERS ONLY — gated on the Supabase role so it can only ever
  // create the caller's own first team, mirroring resolveAuthzDecision's owner-only branch. An
  // existing NON-owner member (no Prisma team yet) must NOT mint a bogus owner team — the route
  // guard below sends them to "/" → awaiting-migration (this route has no role gate, so a
  // non-owner CAN reach here by direct navigation). Idempotent (the backend adopts an
  // existing/concurrent team). The two team-id spaces stay separate: this never feeds a Supabase
  // id to the backend or vice-versa.
  useEffect(() => {
    if (AUTH_SOURCE !== 'me' || !enabled || loading || !session) return
    if (!team.team || team.role !== 'owner' || !authz.me?.onboardingRequired || prismaAttempted.current) return
    prismaAttempted.current = true
    void createOnboardingTeam(team.team.name)
      .then(() => authz.refresh())
      .catch((err: unknown) => {
        prismaAttempted.current = false
        const msg = err instanceof ApiError
          ? (err.status === 409
              ? 'You have a pending invitation — accept it from your email to join that workspace.'
              : err.message)
          : 'Could not finish creating your workspace.'
        setProvisionError(msg)
      })
    // authz.refresh/createOnboardingTeam are stable enough; team identity + role drive this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, loading, session, team.team?.id, team.team?.name, team.role, authz.me?.onboardingRequired])

  // Guards (in order). Onboarding needs a real session. We ensure a workspace exists
  // BEFORE the survey and BEFORE the already-onboarded redirect — otherwise an
  // onboarded-but-teamless user would loop between "/" and "/onboarding". The
  // already-onboarded user who just finished (done) keeps their completion screen.
  if (!enabled) return <Navigate to="/" replace />
  if (loading || team.loading) {
    return <div className="flex h-screen w-full items-center justify-center bg-canvas"><Spinner size={24} /></div>
  }
  if (!session) return <Navigate to="/login?redirect=/onboarding" replace />
  // Suspended members never provision a bypass team — the gate shows the suspended
  // state at "/".
  if (team.suspended) return <Navigate to="/" replace />
  if (provisionError) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-canvas px-6 text-center text-fg">
        <h1 className="mono text-sm font-bold uppercase tracking-widest text-white/85">Couldn’t create your workspace</h1>
        <p className="mono max-w-[340px] text-[11px] leading-relaxed text-white/40">{provisionError}</p>
        <button type="button" onClick={retryProvision} className="btn-accent mono px-5 py-2.5 text-[11px] uppercase tracking-widest">
          Try again
        </button>
      </div>
    )
  }
  // First workspace still being created (the provision effect is in flight).
  if (!team.team && !done) {
    return <div className="flex h-screen w-full items-center justify-center bg-canvas"><Spinner size={24} /></div>
  }
  // me-mode: ONLY a Supabase owner provisions/mints a first workspace here. An existing non-owner
  // member who reaches /onboarding directly (this route has no role gate) has a Supabase team but
  // no Prisma team yet — they must NOT mint a bogus owner team. Send them to "/", where the gate
  // holds them in `awaiting-migration` until the Step 3 migration backfills their real Prisma
  // membership. (Guard on a RESOLVED non-owner role only, so a freshly-provisioned owner — whose
  // role briefly resolves after the team — is never bounced.)
  if (AUTH_SOURCE === 'me' && !done && team.team && team.role && team.role !== 'owner') {
    return <Navigate to="/" replace />
  }
  // me-mode: an already-onboarded owner whose authoritative PRISMA team is still being minted
  // (the dual-write effect above is in flight) waits here. Bouncing to "/" now would loop back
  // through the gate — which still sees onboardingRequired — until the mint completes.
  if (AUTH_SOURCE === 'me' && !done && user?.user_metadata?.onboarded && authz.me?.onboardingRequired) {
    return <div className="flex h-screen w-full items-center justify-center bg-canvas"><Spinner size={24} /></div>
  }
  if (!done && user?.user_metadata?.onboarded) return <Navigate to="/" replace />

  const set = (patch: Partial<Answers>) => setA((prev) => ({ ...prev, ...patch }))
  const toggle = (field: 'obstacles' | 'conversions', key: string) =>
    setA((prev) => ({
      ...prev,
      [field]: prev[field].includes(key) ? prev[field].filter((k) => k !== key) : [...prev[field], key],
    }))

  const stepValid = (): boolean => {
    switch (step) {
      case 0: return a.fullName.trim().length > 1
      case 1: return a.goal !== '' && (a.goal !== 'other' || a.goalOther.trim() !== '')
      case 2: return a.obstacles.length > 0 && (!a.obstacles.includes('other') || a.obstaclesOther.trim() !== '')
      case 3: return a.pastExperience !== '' && (a.pastExperience !== 'other_saas' || a.pastExperienceOther.trim() !== '')
      case 4: return a.scale !== ''
      case 5: return a.referral !== '' && (a.referral !== 'other' || a.referralOther.trim() !== '')
      case 6: return a.conversions.length > 0 && (!a.conversions.includes('other') || a.conversionsOther.trim() !== '')
      default: return true
    }
  }

  const next = () => { if (step < TOTAL_STEPS - 1) setStep((s) => s + 1); else void finish() }
  const back = () => setStep((s) => Math.max(0, s - 1))

  const finish = async () => {
    if (saving) return
    setSaving(true)
    // Resolve "Other" free-text into the stored values.
    const goal = a.goal === 'other' ? a.goalOther.trim() : labelFor(GOALS, a.goal)
    const obstacles = a.obstacles.map((k) => (k === 'other' ? a.obstaclesOther.trim() : labelFor(OBSTACLES, k))).filter(Boolean)
    const pastExperience = a.pastExperience === 'other_saas'
      ? `Another SaaS: ${a.pastExperienceOther.trim()}`
      : labelFor(PAST, a.pastExperience)
    const referral = a.referral === 'other' ? a.referralOther.trim() : labelFor(REFERRAL, a.referral)
    const conversions = a.conversions.map((k) => (k === 'other' ? a.conversionsOther.trim() : labelFor(CONVERSIONS, k))).filter(Boolean)

    if (supabase && user) {
      const { error } = await supabase.from('onboarding_responses').insert({
        user_id: user.id,
        team_id: team.team?.id ?? null,
        full_name: a.fullName.trim(),
        company_name: a.companyName.trim() || null,
        goal,
        obstacles,
        past_experience: pastExperience,
        scale: a.scale,
        referral_source: referral,
        conversion_reasons: conversions,
      })
      if (error) {
        setSaving(false)
        addToast(`Could not save onboarding: ${error.message}`, 'error')
        return
      }
      // Disarm the onboarded-redirect guard BEFORE updateUser fires USER_UPDATED,
      // so the completion screen isn't skipped.
      setDone(true)
      // Mark onboarded + capture the name so the gate won't route here again.
      await supabase.auth.updateUser({ data: { onboarded: true, full_name: a.fullName.trim() } }).catch(() => undefined)
    } else {
      setDone(true)
    }
    clearOnboardingProgress()
    setStep(TOTAL_STEPS) // completion screen
    setSaving(false)
  }

  const firstName = (a.fullName.trim().split(/\s+/)[0] || 'there')

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative flex min-h-[100dvh] w-full flex-col overflow-hidden bg-canvas text-fg">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute inset-0 app-bg-grid" />
          <div className="absolute inset-0 app-bg-glow" />
          <div className="absolute inset-0 app-bg-noise" />
          <div className="absolute inset-0 app-bg-vignette" />
        </div>

        {/* Progress bar */}
        {step < TOTAL_STEPS && (
          <div className="relative z-10 px-6 pt-6 sm:px-10">
            <div className="mx-auto flex max-w-[680px] items-center gap-4">
              <div className="mono flex items-center gap-2 text-[11px] uppercase tracking-[0.28em] text-[var(--accent-text)]">
                <BrandLogo className="h-5 w-5" />
                <span className="font-bold" style={{ fontFamily: 'Arimo, "Helvetica Neue", Helvetica, Arial, sans-serif' }}>MobFleet</span>
              </div>
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: 'var(--accent)' }}
                  initial={false}
                  animate={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
                  transition={{ duration: 0.4, ease: EXPO_OUT }}
                />
              </div>
              <span className="mono text-[10px] uppercase tracking-widest text-white/35">Step {step + 1} / {TOTAL_STEPS}</span>
            </div>
          </div>
        )}

        <div className="relative z-10 flex flex-1 items-center justify-center px-6 py-10 sm:px-10">
          <div className="w-full max-w-[680px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.34, ease: EXPO_OUT }}
              >
                {step === TOTAL_STEPS ? (
                  <Completion firstName={firstName} scale={a.scale} onEnter={() => navigate('/', { replace: true })} />
                ) : (
                  <StepBody
                    step={step} a={a} set={set} toggle={toggle}
                    valid={stepValid()} saving={saving}
                    onBack={back} onNext={next} isLast={step === TOTAL_STEPS - 1}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </MotionConfig>
  )
}

// ─── Step body ───────────────────────────────────────────────────────────────

function StepBody({ step, a, set, toggle, valid, saving, onBack, onNext, isLast }: {
  step: number
  a: Answers
  set: (p: Partial<Answers>) => void
  toggle: (f: 'obstacles' | 'conversions', key: string) => void
  valid: boolean
  saving: boolean
  onBack: () => void
  onNext: () => void
  isLast: boolean
}) {
  return (
    <div>
      <Heads step={step} />
      <div className="mt-7 space-y-3">
        {step === 0 && (
          <div className="space-y-4">
            <Field label="Full name" value={a.fullName} onChange={(v) => set({ fullName: v })} placeholder="Alex Rivera" autoFocus />
            <Field label="Company / brand name" value={a.companyName} onChange={(v) => set({ companyName: v })} placeholder="Acme Operations" />
          </div>
        )}
        {step === 1 && (
          <CardGroup
            options={GOALS} selected={a.goal ? [a.goal] : []}
            onSelect={(k) => set({ goal: k })}
            other={a.goal === 'other' ? a.goalOther : null} onOther={(v) => set({ goalOther: v })}
          />
        )}
        {step === 2 && (
          <CardGroup
            options={OBSTACLES} multi selected={a.obstacles}
            onSelect={(k) => toggle('obstacles', k)}
            other={a.obstacles.includes('other') ? a.obstaclesOther : null} onOther={(v) => set({ obstaclesOther: v })}
          />
        )}
        {step === 3 && (
          <CardGroup
            options={PAST} selected={a.pastExperience ? [a.pastExperience] : []}
            onSelect={(k) => set({ pastExperience: k })}
            other={a.pastExperience === 'other_saas' ? a.pastExperienceOther : null}
            onOther={(v) => set({ pastExperienceOther: v })} otherPlaceholder="Which platform?"
          />
        )}
        {step === 4 && (
          <CardGroup options={SCALE} selected={a.scale ? [a.scale] : []} onSelect={(k) => set({ scale: k })} big />
        )}
        {step === 5 && (
          <CardGroup
            options={REFERRAL} selected={a.referral ? [a.referral] : []}
            onSelect={(k) => set({ referral: k })}
            other={a.referral === 'other' ? a.referralOther : null} onOther={(v) => set({ referralOther: v })}
          />
        )}
        {step === 6 && (
          <CardGroup
            options={CONVERSIONS} multi selected={a.conversions}
            onSelect={(k) => toggle('conversions', k)}
            other={a.conversions.includes('other') ? a.conversionsOther : null} onOther={(v) => set({ conversionsOther: v })}
          />
        )}
      </div>

      <div className="mt-8 flex items-center justify-between">
        <button
          onClick={onBack}
          disabled={step === 0}
          className="mono flex items-center gap-1.5 px-2 py-2 text-[11px] uppercase tracking-widest text-white/40 transition-colors hover:text-white/80 disabled:opacity-0"
        >
          <ArrowLeft size={13} /> Back
        </button>
        <button
          onClick={onNext}
          disabled={!valid || saving}
          className="btn-accent mono flex items-center gap-2 rounded-control px-6 py-2.5 text-[11px] uppercase tracking-widest disabled:opacity-40"
        >
          {saving ? <Spinner size={13} /> : null}
          {isLast ? 'Finish' : 'Continue'}
          {!saving && <ArrowRight size={13} />}
        </button>
      </div>
    </div>
  )
}

const HEADINGS: { title: string; sub?: string }[] = [
  { title: "Let's set up your command center." },
  { title: "What's your main goal with MobFleet?", sub: 'No wrong answers — this helps us tailor your experience.' },
  { title: "What's been the biggest challenge so far?", sub: "What's held you back from scaling?" },
  { title: 'Have you used any phone management tools before?' },
  { title: 'How many phones are you planning to manage?' },
  { title: 'How did you hear about MobFleet?' },
  { title: 'What made you decide to sign up?', sub: 'This helps us keep delivering what matters.' },
]

function Heads({ step }: { step: number }) {
  const h = HEADINGS[step]
  if (!h) return null
  return (
    <div>
      <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-white sm:text-[30px]">{h.title}</h1>
      {h.sub && <p className="mt-2 text-[14px] leading-relaxed text-white/55">{h.sub}</p>}
    </div>
  )
}

// ─── Primitives ──────────────────────────────────────────────────────────────

function Field({ label, value, onChange, placeholder, autoFocus }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean
}) {
  return (
    <div>
      <label className="mono mb-1.5 block text-[10px] uppercase tracking-wider text-white/50">{label}</label>
      <input
        value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus}
        className="mono h-11 w-full rounded-control border border-line bg-elevated px-3 text-[13px] text-fg outline-none transition-[border-color,box-shadow] placeholder:text-white/25 focus:border-[var(--accent-border)] focus:shadow-[0_0_0_3px_var(--accent-soft)]"
      />
    </div>
  )
}

function CardGroup({ options, selected, onSelect, multi, other, onOther, otherPlaceholder = 'Tell us more…', big }: {
  options: Opt[]
  selected: string[]
  onSelect: (key: string) => void
  multi?: boolean
  other?: string | null
  onOther?: (v: string) => void
  otherPlaceholder?: string
  big?: boolean
}) {
  const showOther = other !== null && other !== undefined
  return (
    <div className={big ? 'grid grid-cols-2 gap-3' : 'space-y-2.5'}>
      {options.map((o) => {
        const active = selected.includes(o.key)
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onSelect(o.key)}
            aria-pressed={active}
            className={[
              'group flex w-full items-center gap-3 rounded-card border px-4 text-left transition-all duration-150',
              big ? 'flex-col items-start justify-center gap-1 py-5' : 'py-3.5',
              active
                ? 'border-[var(--accent-border)] bg-[var(--accent-soft)]'
                : 'border-line bg-panel/40 hover:border-white/25 hover:bg-hover',
            ].join(' ')}
          >
            {o.icon && <span className="text-[20px] leading-none">{o.icon}</span>}
            <span className="min-w-0 flex-1">
              <span className={`block ${big ? 'mono text-[22px] font-bold tabular-nums' : 'text-[13.5px]'} ${active ? 'text-white' : 'text-white/80'}`}>{o.label}</span>
              {o.sub && <span className="mt-0.5 block text-[11px] text-white/40">{o.sub}</span>}
            </span>
            <span
              className={[
                'flex h-5 w-5 shrink-0 items-center justify-center border transition-colors',
                multi ? 'rounded-control' : 'rounded-full',
                active ? 'border-[var(--accent-border)] bg-[var(--accent)]' : 'border-white/20',
              ].join(' ')}
            >
              {active && <Check size={12} className="text-black" />}
            </span>
          </button>
        )
      })}
      {showOther && onOther && (
        <input
          autoFocus
          value={other ?? ''}
          onChange={(e) => onOther(e.target.value)}
          placeholder={otherPlaceholder}
          className="mono mt-1 h-11 w-full rounded-control border border-[var(--accent-border)] bg-elevated px-3 text-[13px] text-fg outline-none placeholder:text-white/25 focus:shadow-[0_0_0_3px_var(--accent-soft)]"
        />
      )}
    </div>
  )
}

// ─── Completion ──────────────────────────────────────────────────────────────

function Completion({ firstName, scale, onEnter }: { firstName: string; scale: string; onEnter: () => void }) {
  const tip = useMemo(() => {
    switch (scale) {
      case '50+': return "You'll want the Enterprise plan for unlimited devices and priority orchestration."
      case '16-50': return 'Your scaling operation is a great fit for fleet groups and bulk automation.'
      case '6-15': return "We'll help you grow your operation with reliable, hands-off automation."
      default: return "We'll help you get your first devices online and automated fast."
    }
  }, [scale])

  return (
    <div className="text-center">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: EXPO_OUT }}
        className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)]"
        style={{ boxShadow: 'inset 0 0 18px rgba(45,212,191,0.3), 0 0 40px rgba(45,212,191,0.18)' }}
      >
        <Rocket size={26} className="text-[var(--accent-text)]" />
      </motion.div>
      <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-white sm:text-[32px]">
        You're all set, {firstName}. 🚀
      </h1>
      <p className="mx-auto mt-3 max-w-[440px] text-[14px] leading-relaxed text-white/55">
        Your fleet control center is ready. {tip}
      </p>
      <button
        onClick={onEnter}
        className="btn-accent mono mx-auto mt-8 flex items-center gap-2 rounded-control px-8 py-3 text-[11px] uppercase tracking-widest"
      >
        Enter Dashboard <ArrowRight size={14} />
      </button>
    </div>
  )
}
