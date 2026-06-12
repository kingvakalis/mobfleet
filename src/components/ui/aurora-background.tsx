import { useEffect, useRef } from 'react'

export function AuroraBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf: number
    let t = 0

    function resize() {
      if (!canvas) return
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const blobs = [
      { x: 0.2, y: 0.3, r: 520, color: '49, 46, 129', ox: 0,    oy: 0,    speed: 0.00018 },
      { x: 0.75, y: 0.2, r: 480, color: '76, 29, 149', ox: 1.4,  oy: 2.1,  speed: 0.00015 },
      { x: 0.5, y: 0.75, r: 560, color: '30, 27, 75',  ox: 2.6,  oy: 0.8,  speed: 0.00012 },
    ]

    function draw() {
      if (!canvas || !ctx) return
      const W = canvas.width
      const H = canvas.height
      ctx.clearRect(0, 0, W, H)

      // Deep background
      ctx.fillStyle = '#050510'
      ctx.fillRect(0, 0, W, H)

      // Draw blobs
      for (const b of blobs) {
        const bx = (b.x + Math.sin(t * b.speed * 1000 + b.ox) * 0.12) * W
        const by = (b.y + Math.cos(t * b.speed * 1000 + b.oy) * 0.10) * H
        const r  = b.r + Math.sin(t * b.speed * 700) * 40

        const grd = ctx.createRadialGradient(bx, by, 0, bx, by, r)
        grd.addColorStop(0,   `rgba(${b.color}, 0.38)`)
        grd.addColorStop(0.5, `rgba(${b.color}, 0.15)`)
        grd.addColorStop(1,   `rgba(${b.color}, 0)`)

        ctx.beginPath()
        ctx.arc(bx, by, r, 0, Math.PI * 2)
        ctx.fillStyle = grd
        ctx.fill()
      }

      // Fine noise via tiny dots
      // (we skip per-pixel noise for performance; use CSS instead)

      t += 16
      raf = requestAnimationFrame(draw)
    }

    draw()
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <>
      {/* Canvas aurora */}
      <canvas
        ref={canvasRef}
        className="fixed inset-0 w-full h-full pointer-events-none"
        style={{ zIndex: 0 }}
      />
      {/* CSS animated blobs for extra depth */}
      <div
        className="fixed inset-0 pointer-events-none overflow-hidden"
        style={{ zIndex: 0 }}
        aria-hidden="true"
      >
        <div className="aurora-blob aurora-blob-1" />
        <div className="aurora-blob aurora-blob-2" />
        <div className="aurora-blob aurora-blob-3" />
        {/* Noise overlay */}
        <div className="aurora-noise" />
      </div>
    </>
  )
}
