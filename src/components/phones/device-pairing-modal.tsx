import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { QRCodeSVG } from 'qrcode.react'
import { Check, Copy, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { useFleet } from '@/hooks/use-fleet'
import { useNow } from '@/hooks/use-now'
import { client } from '@/lib/provider'
import { EXPO_OUT } from '@/lib/motion'
import { useUIStore } from '@/state/ui-store'
import type { Device, PairingToken } from '@/shared/types'

function countdown(msLeft: number): string {
  const s = Math.max(0, Math.floor(msLeft / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function Inner({ onClose }: { onClose: () => void }) {
  const snapshot = useFleet()
  const now = useNow(1000)
  const [token, setToken] = useState<PairingToken | null>(null)
  const [minting, setMinting] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle')

  // Devices present at mint time → anything new is the device that just paired.
  // `baseline` is state (read during render); `devicesRef` only feeds mint() and
  // is updated in an effect (never written/read during render).
  const devicesRef = useRef(snapshot.devices)
  useEffect(() => {
    devicesRef.current = snapshot.devices
  }, [snapshot.devices])
  const [baseline, setBaseline] = useState<Set<string>>(() => new Set())

  // Guard against concurrent / StrictMode double-invoke minting (would otherwise
  // POST /v1/devices/pair twice, creating two throwaway tokens).
  const mintingRef = useRef(false)
  const mint = useCallback(async () => {
    if (mintingRef.current) return
    mintingRef.current = true
    setMinting(true)
    setError(null)
    setToken(null)
    setBaseline(new Set(devicesRef.current.map((d) => d.id)))
    try {
      setToken(await client.createPairingToken())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create a pairing token.')
    } finally {
      mintingRef.current = false
      setMinting(false)
    }
  }, [])

  useEffect(() => {
    void mint() // mint() guards its own state writes behind mintingRef
  }, [mint])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Derived during render: the first device that appeared after the token was
  // minted — i.e. the device that just paired (arrives live over the WS feed).
  const paired: Device | null = token
    ? snapshot.devices.find((d) => !baseline.has(d.id)) ?? null
    : null
  const msLeft = token ? token.expiresAt - now : 0
  const expired = token != null && msLeft <= 0 && !paired

  const qrPayload = token ? JSON.stringify({ serverUrl: token.serverUrl, pairingToken: token.pairingToken }) : ''

  const copy = () => {
    if (!token) return
    const done = (ok: boolean) => {
      setCopyState(ok ? 'ok' : 'fail')
      setTimeout(() => setCopyState('idle'), ok ? 1500 : 2000)
    }
    try {
      const cb = navigator.clipboard
      if (!cb) return done(false)
      void cb.writeText(token.pairingToken).then(() => done(true), () => done(false))
    } catch {
      done(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-6">
      <motion.div
        className="absolute inset-0 bg-black/40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Add device"
        className="relative w-[420px] max-w-full rounded-card border border-line bg-panel/95 p-6 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.85)] backdrop-blur-sm"
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 6 }}
        transition={{ duration: 0.22, ease: EXPO_OUT }}
      >
        <div className="flex items-center justify-between">
          <Label className="text-fg">Add Device</Label>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-elevated hover:text-fg"
          >
            <X size={15} />
          </button>
        </div>

        <div className="mt-5 flex min-h-[300px] flex-col items-center justify-center">
          {error ? (
            <div className="flex flex-col items-center gap-4 text-center">
              <p role="alert" className="rounded-control border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
                {error}
              </p>
              <Button variant="outline" size="sm" onClick={() => void mint()}>
                <RefreshCw size={13} /> Try again
              </Button>
            </div>
          ) : minting || !token ? (
            <div className="flex flex-col items-center gap-3">
              <Spinner size={22} />
              <p className="mono text-[11px] text-white/40">Generating pairing code…</p>
            </div>
          ) : paired ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-3 text-center"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-full" style={{ background: 'color-mix(in srgb, var(--status-online) 16%, transparent)' }}>
                <Check size={26} style={{ color: 'var(--status-online)' }} />
              </div>
              <Label className="text-fg">Device paired</Label>
              <p className="mono text-[12px] text-white/60">
                <span className="text-white">{paired.name}</span> joined the fleet
              </p>
              <p className="mono text-[10px] text-white/30">It appeared live via the device feed.</p>
              <Button variant="primary" size="sm" className="mt-1" onClick={onClose}>Done</Button>
            </motion.div>
          ) : expired ? (
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-elevated">
                <RefreshCw size={22} className="text-white/40" />
              </div>
              <Label className="text-fg-secondary">Pairing code expired</Label>
              <p className="mono max-w-[260px] text-[11px] leading-relaxed text-white/40">
                Codes are valid for 10 minutes. Generate a fresh one to continue.
              </p>
              <Button variant="primary" size="sm" onClick={() => void mint()}>
                <RefreshCw size={13} /> New code
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              {/* White card so the QR scans reliably against the dark UI. */}
              <div className="rounded-card bg-white p-3">
                <QRCodeSVG value={qrPayload} size={188} level="M" marginSize={0} bgColor="#ffffff" fgColor="#0a0a0b" />
              </div>
              <p className="mono max-w-[280px] text-center text-[11px] leading-relaxed text-white/45">
                Scan with the device agent to pair it. The new device appears here automatically.
              </p>

              <button
                type="button"
                onClick={copy}
                title="Copy pairing token"
                className="mono flex max-w-full items-center gap-2 rounded-control border border-line bg-elevated px-3 py-1.5 text-[10px] text-white/55 transition-colors hover:text-white/90"
              >
                {copyState === 'ok' ? (
                  <Check size={12} className="shrink-0" style={{ color: 'var(--status-online)' }} />
                ) : (
                  <Copy size={12} className={`shrink-0 ${copyState === 'fail' ? 'text-[#ff3b3b]' : 'text-white/30'}`} />
                )}
                <span className="truncate">{copyState === 'fail' ? 'Copy failed — select the token manually' : token.pairingToken}</span>
              </button>

              <div className="mono flex items-center gap-1.5 text-[10px] text-white/40">
                <span className="status-dot-pulse h-1.5 w-1.5 rounded-full" style={{ background: 'var(--status-warming)' }} />
                Waiting for device · expires in {countdown(msLeft)}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  )
}

/** "Add Device" provisioning overlay: mints a pairing token, shows its QR, and
 *  watches the live fleet so the claimed device appears in real time. */
export function DevicePairingModal() {
  const open = useUIStore((s) => s.pairOpen)
  const close = useUIStore((s) => s.closePair)
  return <AnimatePresence>{open && <Inner onClose={close} />}</AnimatePresence>
}
