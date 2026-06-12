import { useEffect, useRef, useState } from 'react'

interface Props {
  density?: 'full' | 'reduced'
}

export function AmbientBackground({ density = 'full' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouseRef  = useRef({ x: 0, y: 0 })
  const frameRef  = useRef<number>(0)
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let W = 0, H = 0
    let t = 0

    // Particles
    const COUNT = density === 'reduced' ? 0 : 28
    const particles = Array.from({ length: COUNT }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.2 + 0.3,
      dx: (Math.random() - 0.5) * 0.00012,
      dy: (Math.random() - 0.5) * 0.00012,
      opacity: Math.random() * 0.3 + 0.05,
    }))

    function resize() {
      W = canvas!.width  = canvas!.offsetWidth
      H = canvas!.height = canvas!.offsetHeight
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    function onMouseMove(e: MouseEvent) {
      mouseRef.current = { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight }
    }
    window.addEventListener('mousemove', onMouseMove, { passive: true })

    function draw() {
      if (!ctx || !canvas) return
      ctx.clearRect(0, 0, W, H)

      // ── Grid ──────────────────────────────────────────────────────────
      if (!reduced) {
        const GRID = 60
        const ox = (t * 0.15) % GRID
        const oy = (t * 0.08) % GRID
        ctx.save()
        ctx.strokeStyle = 'rgba(255,255,255,0.025)'
        ctx.lineWidth = 0.5
        for (let x = -GRID + ox; x < W + GRID; x += GRID) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
        }
        for (let y = -GRID + oy; y < H + GRID; y += GRID) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
        }
        ctx.restore()
      }

      // ── Ambient radial light ───────────────────────────────────────────
      const mx = mouseRef.current.x
      const my = mouseRef.current.y
      const lx = W * (0.35 + mx * 0.3 + Math.sin(t * 0.0005) * 0.06)
      const ly = H * (0.25 + my * 0.3 + Math.cos(t * 0.0004) * 0.06)

      const g1 = ctx.createRadialGradient(lx, ly, 0, lx, ly, W * 0.55)
      g1.addColorStop(0, 'rgba(99,102,241,0.08)')
      g1.addColorStop(0.5, 'rgba(79,70,229,0.04)')
      g1.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g1
      ctx.fillRect(0, 0, W, H)

      // Secondary light — bottom right
      const lx2 = W * (0.75 + Math.sin(t * 0.0003) * 0.08)
      const ly2 = H * (0.8  + Math.cos(t * 0.0004) * 0.06)
      const g2 = ctx.createRadialGradient(lx2, ly2, 0, lx2, ly2, W * 0.4)
      g2.addColorStop(0, 'rgba(16,185,129,0.04)')
      g2.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g2
      ctx.fillRect(0, 0, W, H)

      // ── Particles ─────────────────────────────────────────────────────
      if (!reduced) {
        for (const p of particles) {
          p.x += p.dx; p.y += p.dy
          if (p.x < 0) p.x = 1; if (p.x > 1) p.x = 0
          if (p.y < 0) p.y = 1; if (p.y > 1) p.y = 0
          ctx.beginPath()
          ctx.arc(p.x * W, p.y * H, p.r, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(148,163,184,' + p.opacity + ')'
          ctx.fill()
        }
      }

      // ── Vignette ──────────────────────────────────────────────────────
      const vg = ctx.createRadialGradient(W/2, H/2, H * 0.3, W/2, H/2, H * 0.85)
      vg.addColorStop(0, 'rgba(0,0,0,0)')
      vg.addColorStop(1, 'rgba(0,0,0,0.45)')
      ctx.fillStyle = vg
      ctx.fillRect(0, 0, W, H)

      t++
      frameRef.current = requestAnimationFrame(draw)
    }

    if (!reduced) {
      draw()
    }

    const handleVis = () => {
      if (document.hidden) {
        cancelAnimationFrame(frameRef.current)
      } else {
        draw()
      }
    }
    document.addEventListener('visibilitychange', handleVis)

    return () => {
      cancelAnimationFrame(frameRef.current)
      ro.disconnect()
      window.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('visibilitychange', handleVis)
    }
  }, [reduced, density])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0 }}
    />
  )
}
