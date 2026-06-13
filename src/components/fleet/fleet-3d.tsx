import React, {
  useRef, useState, useMemo, useCallback, useEffect, Suspense,
} from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Billboard, Text, Environment, Lightformer } from '@react-three/drei'
// Postprocessing uses three's OWN EffectComposer (three/examples/jsm) — single
// Three.js instance, so the dual-instance WebGL crash from
// @react-three/postprocessing cannot recur.
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import * as THREE from 'three'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  Maximize2, RotateCcw, Target,
  Activity,
  ChevronDown, ChevronUp,
} from 'lucide-react'
import monoFont from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff'
import { useFleet, useFleetStats } from '@/hooks/use-fleet'
import { useUIStore, fleetFiltersActive, type FleetFilters } from '@/state/ui-store'
import { useSettings } from '@/state/settings-store'
import { matchesDevice } from '@/lib/fleet-filtering'
import { graphBus } from '@/lib/graph-bus'
import type { DeviceStatus } from '@/lib/status'

// ─── Constants ───────────────────────────────────────────────────────────────

/** Status colors — the design-token palette (`--status-*`), not a generic one. */
const STATUS_COLOR: Record<DeviceStatus, string> = {
  online:  '#00ff88',
  busy:    '#4fc3f7',
  warming: '#ffb300',
  offline: '#3d3d46',
  error:   '#ff3b3b',
}
const CORE_COLOR = '#4fc3f7'

const INTRO_CAM:   [number, number, number] = [0, 14, 27]
const DEFAULT_CAM: [number, number, number] = [0, 5.5, 15]

const easeOutExpo = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x))
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

// Per-frame scratch objects — never allocate inside useFrame.
const _vA = new THREE.Vector3()
const _vB = new THREE.Vector3()
const _vDir = new THREE.Vector3()
const _introEnd = new THREE.Vector3(...DEFAULT_CAM)

// ─── Types ───────────────────────────────────────────────────────────────────

interface NodeData {
  id: string
  name: string
  status: DeviceStatus
  pos: [number, number, number]
  model?: string
  region?: string
  job?: string
  /** Fails the active fleet filters → faded, labels minimal. */
  dimmed?: boolean
}

interface ContextMenuState {
  nodeId: string
  name: string
  x: number
  y: number
}

// ─── Postprocessing — bloom via three's own composer ─────────────────────────

function Effects() {
  const { gl, scene, camera, size } = useThree()

  const composer = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(size.width, size.height, {
      type: THREE.HalfFloatType,
      samples: 4,
    })
    const c = new EffectComposer(gl, target)
    c.addPass(new RenderPass(scene, camera))
    // Restrained bloom — status lights and pulses glow, surfaces don't blow out.
    c.addPass(new UnrealBloomPass(new THREE.Vector2(size.width, size.height), 0.42, 0.45, 0.28))
    c.addPass(new OutputPass())
    return c
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera])

  useEffect(() => {
    composer.setPixelRatio(gl.getPixelRatio())
    composer.setSize(size.width, size.height)
  }, [composer, gl, size])

  useEffect(() => () => composer.dispose(), [composer])

  // Priority 1 takes over the render loop from R3F.
  useFrame(() => composer.render(), 1)
  return null
}

// ─── Starfield ───────────────────────────────────────────────────────────────

function Starfield({ reduced }: { reduced: boolean }) {
  const ref = useRef<THREE.Points>(null)

  const positions = useMemo(() => {
    const N = 850
    const arr = new Float32Array(N * 3)
    let seed = 1337
    const rnd = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    for (let i = 0; i < N; i++) {
      const r = 16 + rnd() * 42
      const theta = rnd() * Math.PI * 2
      const phi = Math.acos(2 * rnd() - 1)
      arr[i * 3]     = r * Math.sin(phi) * Math.cos(theta)
      arr[i * 3 + 1] = r * Math.cos(phi) * 0.6
      arr[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
    }
    return arr
  }, [])

  useFrame((_, dt) => {
    if (ref.current && !reduced) ref.current.rotation.y += dt * 0.005
  })

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.05}
        sizeAttenuation
        color="#8aa3cc"
        transparent
        opacity={0.32}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  )
}

// ─── Floor grid ──────────────────────────────────────────────────────────────

function FloorGrid() {
  const grid = useMemo(() => {
    const g = new THREE.PolarGridHelper(17, 20, 7, 80, 0x1b1b24, 0x12121a)
    const mat = g.material as THREE.LineBasicMaterial
    mat.transparent = true
    mat.opacity = 0.55
    mat.depthWrite = false
    return g
  }, [])
  useEffect(() => () => {
    grid.geometry.dispose()
    ;(grid.material as THREE.Material).dispose()
  }, [grid])
  return <primitive object={grid} position={[0, -4.2, 0]} />
}

// ─── Energy link (curved tube + shader pulse) ────────────────────────────────

const LINK_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const LINK_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform vec3  uColor;
  uniform float uBase;   // resting brightness
  uniform float uPulse;  // pulse amplitude
  uniform float uSpeed;  // pulse travel speed
  uniform float uFlash;  // 1 = error flicker

  float gauss(float x, float c, float w) {
    float d = x - c;
    return exp(-(d * d) / (w * w));
  }

  void main() {
    float p = fract(uTime * uSpeed);
    float e = gauss(vUv.x, p, 0.030)
            + 0.55 * gauss(vUv.x, fract(p - 0.10), 0.045);
    float flick = mix(1.0, 0.55 + 0.45 * sin(uTime * 11.0), uFlash);
    float i = (uBase + uPulse * e) * flick;
    i *= smoothstep(0.0, 0.05, vUv.x) * smoothstep(1.0, 0.96, vUv.x);
    gl_FragColor = vec4(uColor * i * 1.7, i);
  }
`

function linkTargets(status: DeviceStatus, selected: boolean, hovered: boolean, dimmed: boolean) {
  let base = 0.05, pulse = 0.35, speed = 0.10, flash = 0
  switch (status) {
    case 'busy':    base = 0.09; pulse = 0.95; speed = 0.50; break
    case 'warming': base = 0.06; pulse = 0.45; speed = 0.22; break
    case 'error':   base = 0.07; pulse = 0.50; speed = 0.30; flash = 1; break
    case 'offline': base = 0.015; pulse = 0;   speed = 0;    break
  }
  if (hovered)  { base += 0.10; pulse += 0.30 }
  if (selected) { base = Math.max(base, 0.26); pulse = Math.max(pulse, 1.1); speed = Math.max(speed, 0.6) }
  if (dimmed && !selected) { base *= 0.2; pulse *= 0.15 }
  return { base, pulse, speed, flash }
}

function EnergyLink({
  to, status, selected, hovered, dimmed = false,
}: {
  to: [number, number, number]
  status: DeviceStatus
  selected: boolean
  hovered: boolean
  dimmed?: boolean
}) {
  const matRef = useRef<THREE.ShaderMaterial>(null)
  const targetColor = useMemo(() => new THREE.Color(STATUS_COLOR[status]), [status])

  const geometry = useMemo(() => {
    const end = new THREE.Vector3(...to)
    const dir = end.clone().setY(0).normalize()
    const start = dir.clone().multiplyScalar(0.95).setY(end.y * 0.08)
    const mid = start.clone().add(end).multiplyScalar(0.5)
    mid.y += end.distanceTo(start) * 0.10
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end)
    return new THREE.TubeGeometry(curve, 36, 0.0085, 5, false)
  }, [to])

  const uniforms = useMemo(() => ({
    uTime:  { value: 0 },
    uColor: { value: new THREE.Color(STATUS_COLOR[status]) },
    uBase:  { value: 0 },
    uPulse: { value: 0 },
    uSpeed: { value: 0.1 },
    uFlash: { value: 0 },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])

  useEffect(() => () => {
    geometry.dispose()
  }, [geometry])

  useFrame(({ clock }, dt) => {
    const m = matRef.current
    if (!m) return
    const t = linkTargets(status, selected, hovered, dimmed)
    const k = 1 - Math.exp(-7 * dt)
    m.uniforms.uTime.value = clock.elapsedTime
    m.uniforms.uBase.value  += (t.base  - m.uniforms.uBase.value)  * k
    m.uniforms.uPulse.value += (t.pulse - m.uniforms.uPulse.value) * k
    m.uniforms.uSpeed.value += (t.speed - m.uniforms.uSpeed.value) * k
    m.uniforms.uFlash.value += (t.flash - m.uniforms.uFlash.value) * k
    ;(m.uniforms.uColor.value as THREE.Color).lerp(targetColor, k)
  })

  return (
    <mesh geometry={geometry}>
      <shaderMaterial
        ref={matRef}
        vertexShader={LINK_VERT}
        fragmentShader={LINK_FRAG}
        uniforms={uniforms}
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  )
}

// ─── Phone screen shader ─────────────────────────────────────────────────────

const SCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const SCREEN_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform vec3  uColor;
  uniform float uActivity; // 0 dark → 1 busy
  uniform float uBoost;    // hover / selection lift
  uniform float uFlash;    // error strobe

  void main() {
    vec2 uv = vUv;
    // bezel vignette
    float vig = smoothstep(0.0, 0.10, uv.x) * smoothstep(1.0, 0.90, uv.x)
              * smoothstep(0.0, 0.07, uv.y) * smoothstep(1.0, 0.93, uv.y);
    // vertical sheen
    float grad = mix(0.8, 1.25, uv.y);
    // slow scan shimmer
    float scan = 1.0 + 0.06 * sin(uv.y * 110.0 - uTime * 2.4);
    // travelling activity band
    float band = exp(-pow((fract(uv.y - uTime * (0.04 + uActivity * 0.22)) - 0.5) * 3.6, 2.0));
    float flash = mix(1.0, 0.6 + 0.4 * sin(uTime * 9.0), uFlash);
    vec3 c = uColor * (0.14 + 0.55 * uActivity * band + 0.45 * uBoost) * grad * scan * flash;
    gl_FragColor = vec4(c * vig + vec3(0.012), 1.0);
  }
`

function screenActivity(status: DeviceStatus): number {
  switch (status) {
    case 'busy':    return 1
    case 'online':  return 0.45
    case 'warming': return 0.6
    case 'error':   return 0.5
    default:        return 0.04
  }
}

// ─── Shared geometry cache (created inside Canvas — single three instance) ──

function usePhoneGeos() {
  const geos = useMemo(() => ({
    // iPhone 17 Pro: titanium frame shell + glossy black front bezel + matte
    // back glass + raised rear camera plateau with a triple-lens array.
    frame:    new RoundedBoxGeometry(0.30, 0.55, 0.052, 5, 0.05),
    panel:    new RoundedBoxGeometry(0.262, 0.498, 0.006, 3, 0.045),
    back:     new RoundedBoxGeometry(0.258, 0.492, 0.006, 3, 0.043),
    screen:   new THREE.PlaneGeometry(0.236, 0.452),
    island:   new THREE.CapsuleGeometry(0.013, 0.05, 6, 14),
    camPlate: new RoundedBoxGeometry(0.135, 0.135, 0.02, 3, 0.032),
    lensRing: new THREE.CylinderGeometry(0.03, 0.032, 0.018, 22),
    lensGlass:new THREE.CylinderGeometry(0.02, 0.02, 0.006, 18),
    dot:      new THREE.CylinderGeometry(0.0085, 0.0085, 0.006, 12),
    btnLong:  new THREE.CapsuleGeometry(0.006, 0.075, 4, 8),
    btnMed:   new THREE.CapsuleGeometry(0.006, 0.045, 4, 8),
    btnShort: new THREE.CapsuleGeometry(0.006, 0.026, 4, 8),
    led:      new THREE.SphereGeometry(0.014, 10, 10),
    arcA:   new THREE.TorusGeometry(0.27, 0.008, 6, 48, Math.PI * 1.3),
    arcB:   new THREE.TorusGeometry(0.315, 0.006, 6, 48, Math.PI * 0.85),
  }), [])
  useEffect(() => () => {
    Object.values(geos).forEach(g => g.dispose())
  }, [geos])
  return geos
}

// ─── Phone node ──────────────────────────────────────────────────────────────

function PhoneNode({
  data, index, selected, hovered, reduced,
  onSelect, onHover, onDoubleClick, onRightClick,
}: {
  data: NodeData
  index: number
  selected: boolean
  hovered:  boolean
  reduced:  boolean
  onSelect:      () => void
  onHover:       (v: boolean) => void
  onDoubleClick: () => void
  onRightClick:  (x: number, y: number) => void
}) {
  const groupRef  = useRef<THREE.Group>(null)
  const bodyRef   = useRef<THREE.MeshPhysicalMaterial>(null)
  const ledRef    = useRef<THREE.MeshBasicMaterial>(null)
  const arcARef   = useRef<THREE.Mesh>(null)
  const arcBRef   = useRef<THREE.Mesh>(null)
  const geos      = usePhoneGeos()
  const mountT    = useRef<number | null>(null)
  const floatOff  = useMemo(() => (index * 0.61803) % (Math.PI * 2), [index])

  const targetColor = useMemo(() => new THREE.Color(STATUS_COLOR[data.status]), [data.status])
  const color = useRef(new THREE.Color(STATUS_COLOR[data.status]))

  const screenRef = useRef<THREE.ShaderMaterial>(null)
  const screenUniforms = useMemo(() => ({
    uTime:     { value: 0 },
    uColor:    { value: new THREE.Color(STATUS_COLOR[data.status]) },
    uActivity: { value: screenActivity(data.status) },
    uBoost:    { value: 0 },
    uFlash:    { value: data.status === 'error' ? 1 : 0 },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])

  useEffect(() => () => { document.body.style.cursor = 'default' }, [])

  useFrame(({ clock }, dt) => {
    const g = groupRef.current
    if (!g) return
    const t = clock.elapsedTime
    if (mountT.current === null) mountT.current = t

    // Warp-in: staggered scale-up, expo-out
    const appear = easeOutExpo(clamp01((t - mountT.current - index * 0.04) / 0.75))

    const k4 = 1 - Math.exp(-4 * dt)
    const k7 = 1 - Math.exp(-7 * dt)

    // Position — float + interaction lift, frame-rate independent
    const floatY = reduced ? 0 : Math.sin(t * 0.6 + floatOff) * 0.05
    const lift = selected ? 0.30 : hovered ? 0.14 : 0
    g.position.x += (data.pos[0] - g.position.x) * k4
    g.position.z += (data.pos[2] - g.position.z) * k4
    g.position.y += (data.pos[1] + floatY + lift - g.position.y) * k4

    // Scale
    const targetScale = (selected ? 1.3 : hovered ? 1.12 : 1) * appear
    const s = g.scale.x + (targetScale - g.scale.x) * k7
    g.scale.setScalar(Math.max(s, 0.0001))

    // Tilt toward camera on hover; gentle idle sway otherwise
    const tiltX = (hovered || selected) ? -0.12 : 0
    const swayY = (hovered || selected) || reduced ? 0 : Math.sin(t * 0.22 + floatOff) * 0.18
    g.rotation.x += (tiltX - g.rotation.x) * k7
    g.rotation.y += (swayY - g.rotation.y) * (1 - Math.exp(-2.5 * dt))

    // Status color crossfade
    color.current.lerp(targetColor, 1 - Math.exp(-6 * dt))

    // Filter dim: material intensity drops, the phone stays faintly present.
    const dimF = data.dimmed && !selected ? 0.18 : 1

    if (bodyRef.current) {
      bodyRef.current.emissive.copy(color.current)
      // Body stays a dark physical object — status reads from LED/screen/arcs.
      const ei = (selected ? 0.28 : hovered ? 0.16 : 0.05) * dimF
      bodyRef.current.emissiveIntensity += (ei - bodyRef.current.emissiveIntensity) * k7
    }
    if (ledRef.current) {
      ledRef.current.color.copy(color.current)
      if (dimF < 1) ledRef.current.color.multiplyScalar(0.35)
    }

    if (screenRef.current) {
      const u = screenRef.current.uniforms
      u.uTime.value = t
      ;(u.uColor.value as THREE.Color).copy(color.current)
      u.uActivity.value += (screenActivity(data.status) * dimF - u.uActivity.value) * k4
      u.uBoost.value += ((selected ? 1 : hovered ? 0.5 : 0) - u.uBoost.value) * k7
      u.uFlash.value += ((data.status === 'error' && dimF === 1 ? 1 : 0) - u.uFlash.value) * k4
    }

    // Selection arcs — counter-rotate, fade with state
    const arcOpacity = selected ? 0.9 : hovered ? 0.45 : 0
    if (arcARef.current) {
      arcARef.current.rotation.z = t * 1.4
      const m = arcARef.current.material as THREE.MeshBasicMaterial
      m.opacity += (arcOpacity - m.opacity) * k7
      m.color.copy(color.current)
    }
    if (arcBRef.current) {
      arcBRef.current.rotation.z = -t * 0.9
      const m = arcBRef.current.material as THREE.MeshBasicMaterial
      m.opacity += (arcOpacity * 0.7 - m.opacity) * k7
      m.color.copy(color.current)
    }
  })

  const statusColor = STATUS_COLOR[data.status]

  return (
    <group
      ref={groupRef}
      position={data.pos}
      scale={0}
      onClick={(e) => { e.stopPropagation(); onSelect() }}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick() }}
      onPointerEnter={(e) => { e.stopPropagation(); onHover(true);  document.body.style.cursor = 'pointer' }}
      onPointerLeave={(e) => { e.stopPropagation(); onHover(false); document.body.style.cursor = 'default' }}
      onContextMenu={(e) => {
        e.nativeEvent.preventDefault()
        const ne = e.nativeEvent as MouseEvent
        onRightClick(ne.clientX, ne.clientY)
      }}
    >
      {/* Titanium frame shell — the satin perimeter rail */}
      <mesh geometry={geos.frame}>
        <meshPhysicalMaterial
          ref={bodyRef}
          color="#4c4c54"
          roughness={0.34}
          metalness={1}
          clearcoat={0.5}
          clearcoatRoughness={0.35}
          envMapIntensity={1.1}
          emissive={statusColor}
          emissiveIntensity={0.05}
        />
      </mesh>

      {/* Glossy black front bezel surrounding the screen */}
      <mesh geometry={geos.panel} position={[0, 0, 0.0245]}>
        <meshPhysicalMaterial color="#050507" roughness={0.12} metalness={0.2} clearcoat={1} clearcoatRoughness={0.06} />
      </mesh>

      {/* Screen */}
      <mesh geometry={geos.screen} position={[0, 0, 0.0285]}>
        <shaderMaterial
          ref={screenRef}
          vertexShader={SCREEN_VERT}
          fragmentShader={SCREEN_FRAG}
          uniforms={screenUniforms}
        />
      </mesh>

      {/* Dynamic Island */}
      <mesh geometry={geos.island} position={[0, 0.188, 0.0295]} rotation={[0, 0, Math.PI / 2]}>
        <meshStandardMaterial color="#000000" roughness={0.4} metalness={0.1} />
      </mesh>

      {/* Matte back glass */}
      <mesh geometry={geos.back} position={[0, 0, -0.0245]}>
        <meshPhysicalMaterial color="#0b0b0f" roughness={0.55} metalness={0.25} clearcoat={0.7} clearcoatRoughness={0.4} />
      </mesh>

      {/* Rear camera plateau + triple-lens array (visible as the camera orbits) */}
      <group position={[-0.062, 0.158, -0.034]}>
        <mesh geometry={geos.camPlate}>
          <meshPhysicalMaterial color="#101015" roughness={0.4} metalness={0.5} clearcoat={0.6} />
        </mesh>
        {([[-0.026, 0.026], [0.026, 0.026], [0, -0.026]] as const).map(([lx, ly], i) => (
          <group key={i} position={[lx, ly, -0.014]} rotation={[Math.PI / 2, 0, 0]}>
            <mesh geometry={geos.lensRing}>
              <meshStandardMaterial color="#1c1c22" roughness={0.25} metalness={0.95} />
            </mesh>
            <mesh geometry={geos.lensGlass} position={[0, -0.007, 0]}>
              <meshPhysicalMaterial color="#05060a" roughness={0.05} metalness={0.3} clearcoat={1} clearcoatRoughness={0.04} />
            </mesh>
          </group>
        ))}
        {/* flash + LiDAR dots */}
        <mesh geometry={geos.dot} position={[0.044, 0.026, -0.012]} rotation={[Math.PI / 2, 0, 0]}>
          <meshStandardMaterial color="#e8e6d8" emissive="#fff8e6" emissiveIntensity={0.4} roughness={0.4} />
        </mesh>
        <mesh geometry={geos.dot} position={[0.044, -0.026, -0.012]} rotation={[Math.PI / 2, 0, 0]}>
          <meshStandardMaterial color="#16161c" roughness={0.3} metalness={0.6} />
        </mesh>
      </group>

      {/* Titanium side controls — action + volume (left), power + camera-control (right) */}
      <mesh geometry={geos.btnShort} position={[-0.1515, 0.135, 0]}>
        <meshStandardMaterial color="#5a5a62" roughness={0.34} metalness={1} />
      </mesh>
      <mesh geometry={geos.btnMed} position={[-0.1515, 0.04, 0]}>
        <meshStandardMaterial color="#5a5a62" roughness={0.34} metalness={1} />
      </mesh>
      <mesh geometry={geos.btnMed} position={[-0.1515, -0.04, 0]}>
        <meshStandardMaterial color="#5a5a62" roughness={0.34} metalness={1} />
      </mesh>
      <mesh geometry={geos.btnLong} position={[0.1515, 0.055, 0]}>
        <meshStandardMaterial color="#5a5a62" roughness={0.34} metalness={1} />
      </mesh>
      <mesh geometry={geos.btnShort} position={[0.1515, -0.07, 0]}>
        <meshStandardMaterial color="#6a6a72" roughness={0.28} metalness={1} />
      </mesh>

      {/* Status LED */}
      <mesh geometry={geos.led} position={[0.085, -0.205, 0.0295]}>
        <meshBasicMaterial ref={ledRef} color={statusColor} />
      </mesh>

      {/* Selection arcs */}
      <mesh ref={arcARef} geometry={geos.arcA} rotation={[Math.PI / 2, 0, 0]}>
        <meshBasicMaterial color={statusColor} transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh ref={arcBRef} geometry={geos.arcB} rotation={[Math.PI / 2, 0, 0]}>
        <meshBasicMaterial color={statusColor} transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>

      {/* Label */}
      <Billboard position={[0, 0.44, 0]}>
        <Text
          font={monoFont}
          fontSize={hovered || selected ? 0.105 : 0.085}
          letterSpacing={0.1}
          color={selected ? '#ffffff' : hovered ? '#e6ecff' : data.dimmed ? '#2e3542' : '#8a93a6'}
          anchorX="center"
          anchorY="middle"
          maxWidth={1.6}
        >
          {data.name.toUpperCase()}
        </Text>
        {(hovered || selected) && !data.dimmed && (
          <Text
            font={monoFont}
            fontSize={0.075}
            letterSpacing={0.12}
            color={statusColor}
            anchorX="center"
            anchorY="middle"
            position={[0, -0.14, 0]}
          >
            {data.status.toUpperCase()}{data.job ? ` · ${data.job.toUpperCase()}` : ''}
          </Text>
        )}
      </Billboard>
    </group>
  )
}

// ─── Orchestrator core ───────────────────────────────────────────────────────

const FRESNEL_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`

const FRESNEL_FRAG = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  uniform vec3  uColor;
  uniform float uIntensity;
  void main() {
    float f = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.6);
    gl_FragColor = vec4(uColor, f * uIntensity);
  }
`

function OrchestratorCore({
  totalActive, totalDevices, reduced, onClick,
}: {
  totalActive: number; totalDevices: number; reduced: boolean; onClick: () => void
}) {
  const coreRef  = useRef<THREE.Mesh>(null)
  const coreMat  = useRef<THREE.MeshStandardMaterial>(null)
  const wireRef  = useRef<THREE.Mesh>(null)
  const ring1Ref = useRef<THREE.Group>(null)
  const ring2Ref = useRef<THREE.Group>(null)
  const ring3Ref = useRef<THREE.Group>(null)
  const [hovered, setHovered] = useState(false)

  const activityRatio = totalDevices > 0 ? totalActive / totalDevices : 0

  const fresnelRef = useRef<THREE.ShaderMaterial>(null)
  const fresnelUniforms = useMemo(() => ({
    uColor:     { value: new THREE.Color(CORE_COLOR) },
    uIntensity: { value: 0.9 },
  }), [])

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime
    const spin = reduced ? 0.25 : 1
    if (ring1Ref.current) ring1Ref.current.rotation.y = t * 0.22 * spin
    if (ring2Ref.current) {
      ring2Ref.current.rotation.x = -t * 0.15 * spin
      ring2Ref.current.rotation.z = t * 0.07 * spin
    }
    if (ring3Ref.current) ring3Ref.current.rotation.z = t * 0.3 * spin
    if (wireRef.current) {
      wireRef.current.rotation.y = -t * 0.06 * spin
      wireRef.current.rotation.x = Math.sin(t * 0.1) * 0.2
    }
    if (coreRef.current) {
      const pulse = 1 + Math.sin(t * (1.1 + activityRatio * 2)) * (reduced ? 0.015 : 0.045)
      coreRef.current.scale.setScalar(pulse)
    }
    if (coreMat.current) {
      const target = hovered ? 1.2 : 0.6
      coreMat.current.emissiveIntensity += (target - coreMat.current.emissiveIntensity) * (1 - Math.exp(-6 * dt))
    }
    if (fresnelRef.current) {
      fresnelRef.current.uniforms.uIntensity.value = (hovered ? 1.3 : 0.85) + Math.sin(t * 1.4) * 0.12
    }
  })

  return (
    <group
      scale={0.78}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      onPointerEnter={() => { setHovered(true);  document.body.style.cursor = 'pointer' }}
      onPointerLeave={() => { setHovered(false); document.body.style.cursor = 'default' }}
    >
      {/* Core */}
      <mesh ref={coreRef}>
        <icosahedronGeometry args={[0.55, 2]} />
        <meshStandardMaterial
          ref={coreMat}
          color="#0a1018"
          roughness={0.1}
          metalness={0.85}
          emissive={CORE_COLOR}
          emissiveIntensity={0.6}
        />
      </mesh>

      {/* Fresnel halo */}
      <mesh>
        <sphereGeometry args={[0.74, 32, 32]} />
        <shaderMaterial
          ref={fresnelRef}
          vertexShader={FRESNEL_VERT}
          fragmentShader={FRESNEL_FRAG}
          uniforms={fresnelUniforms}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.BackSide}
        />
      </mesh>

      {/* Outer wireframe cage */}
      <mesh ref={wireRef}>
        <icosahedronGeometry args={[1.05, 1]} />
        <meshBasicMaterial color={CORE_COLOR} wireframe transparent opacity={0.07} depthWrite={false} />
      </mesh>

      {/* Gyroscope rings — satellites ride inside the rotating groups */}
      <group ref={ring1Ref}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.55, 0.012, 6, 96]} />
          <meshBasicMaterial color={CORE_COLOR} transparent opacity={0.3} depthWrite={false} />
        </mesh>
        <mesh position={[1.55, 0, 0]}>
          <sphereGeometry args={[0.045, 8, 8]} />
          <meshBasicMaterial color="#bfe8ff" />
        </mesh>
      </group>
      <group ref={ring2Ref}>
        <mesh rotation={[Math.PI / 2.6, 0.4, 0]}>
          <torusGeometry args={[2.05, 0.008, 6, 96]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.12} depthWrite={false} />
        </mesh>
        <mesh position={[0, 1.45, 1.45]}>
          <sphereGeometry args={[0.035, 8, 8]} />
          <meshBasicMaterial color="#9adcff" />
        </mesh>
      </group>
      <group ref={ring3Ref}>
        <mesh rotation={[0, Math.PI / 2, Math.PI / 5]}>
          <torusGeometry args={[1.3, 0.006, 6, 96]} />
          <meshBasicMaterial color="#7dd3fc" transparent opacity={0.18} depthWrite={false} />
        </mesh>
      </group>

      {/* Activity arc — busy ratio */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.92, 0.028, 4, 64, Math.PI * 2 * Math.max(0.02, activityRatio)]} />
        <meshBasicMaterial color="#00ff88" transparent opacity={0.7} depthWrite={false} />
      </mesh>

      {/* Heart light */}
      <pointLight color={CORE_COLOR} intensity={hovered ? 4 : 2.2} distance={9} decay={2} />

      <Billboard position={[0, -1.05, 0]}>
        <Text font={monoFont} fontSize={0.16} letterSpacing={0.25} color="#dce7f5" anchorX="center" anchorY="middle">
          ORCHESTRATOR
        </Text>
        <Text font={monoFont} fontSize={0.095} letterSpacing={0.18} color="#5b6675" anchorX="center" anchorY="middle" position={[0, -0.21, 0]}>
          {totalActive}/{totalDevices} ACTIVE
        </Text>
      </Billboard>
    </group>
  )
}

// ─── Camera rig — intro flight + selection focus, damped ─────────────────────

function CameraRig({
  selectedPos, autoRotate, controlsRef, interactedRef, focusReq,
}: {
  selectedPos: [number, number, number] | null
  autoRotate: boolean
  controlsRef: React.RefObject<OrbitControlsImpl | null>
  interactedRef: React.RefObject<boolean>
  focusReq?: { center: [number, number, number]; radius: number; key: number } | null
}) {
  const { camera } = useThree()
  const intro   = useRef(true)
  const arrived = useRef(false)
  const lastKey = useRef('')
  const focusDone = useRef(0)

  useFrame((_, dt) => {
    const ctl = controlsRef.current
    if (!ctl) return
    ctl.autoRotate = autoRotate

    // Focus-matches: glide to frame the requested bounds, then release control.
    if (focusReq && focusDone.current !== focusReq.key) {
      intro.current = false
      _vA.set(focusReq.center[0], focusReq.center[1], focusReq.center[2])
      const dist = Math.max(6, focusReq.radius * 1.9 + 3)
      _vDir.copy(camera.position).sub(ctl.target)
      if (_vDir.lengthSq() < 0.01) _vDir.set(0, 0.4, 1)
      _vDir.normalize()
      _vB.copy(_vA).addScaledVector(_vDir, dist)
      const k = 1 - Math.exp(-3 * dt)
      ctl.target.lerp(_vA, k)
      camera.position.lerp(_vB, k)
      if (camera.position.distanceTo(_vB) < 0.15 && ctl.target.distanceTo(_vA) < 0.1) {
        focusDone.current = focusReq.key
      }
      return
    }

    const key = selectedPos ? selectedPos.join(',') : ''
    if (key !== lastKey.current) {
      lastKey.current = key
      arrived.current = false
    }

    if (selectedPos && !arrived.current) {
      intro.current = false
      _vA.set(selectedPos[0], selectedPos[1], selectedPos[2])
      _vDir.set(_vA.x, 0, _vA.z).normalize()
      _vB.copy(_vA).addScaledVector(_vDir, 3.6)
      _vB.y = _vA.y + 1.5
      const k = 1 - Math.exp(-2.8 * dt)
      ctl.target.lerp(_vA, k)
      camera.position.lerp(_vB, k)
      if (camera.position.distanceTo(_vB) < 0.12 && ctl.target.distanceTo(_vA) < 0.08) {
        arrived.current = true
      }
    } else if (intro.current) {
      if (interactedRef.current) {
        intro.current = false
        return
      }
      const k = 1 - Math.exp(-1.7 * dt)
      camera.position.lerp(_introEnd, k)
      if (camera.position.distanceTo(_introEnd) < 0.1) intro.current = false
    }
  })

  return null
}

// ─── Scene ───────────────────────────────────────────────────────────────────

function Scene({
  onNodeSelect, onNodeDoubleClick, onContextMenu, selectedId, hoveredId,
  setHoveredId, autoRotate, controlsRef, interactedRef, reduced, filters,
}: {
  onNodeSelect:      (id: string) => void
  onNodeDoubleClick: (id: string) => void
  onContextMenu:     (nodeId: string, name: string, x: number, y: number) => void
  selectedId:  string | null
  hoveredId:   string | null
  setHoveredId:(id: string | null) => void
  autoRotate:  boolean
  controlsRef: React.RefObject<OrbitControlsImpl | null>
  interactedRef: React.RefObject<boolean>
  reduced: boolean
  filters?: FleetFilters
}) {
  const snapshot = useFleet()
  const stats    = useFleetStats()
  const filtersOn = filters ? fleetFiltersActive(filters) : false

  const nodes = useMemo<NodeData[]>(() => {
    const devList = snapshot?.devices ?? []
    const jobById = new Map((snapshot?.jobs ?? []).map(j => [j.id, j]))
    return devList
      .map((d, i) => {
        const shell  = Math.floor(i / 10)
        const radius = 4.6 + shell * 2.5 + (((i * 2654435761) >>> 16) % 100) / 100 * 0.7 - 0.35
        const count  = Math.min(10, devList.length - shell * 10)
        const angle  = (i % count) * (Math.PI * 2 / Math.max(1, count)) + shell * 0.62
        const elev   = ((i % 7) - 3) * 0.85
        const job    = d.jobId ? jobById.get(d.jobId) : undefined
        const isMatch = !filtersOn || matchesDevice(filters!, d, job ?? null)
        return {
          id:     d.id,
          name:   d.name ?? d.id,
          status: (d.status ?? 'offline') as DeviceStatus,
          model:  d.model,
          region: d.region,
          job:    job?.type,
          dimmed: filtersOn && !isMatch,
          pos:    [Math.cos(angle) * radius, elev, Math.sin(angle) * radius] as [number, number, number],
        }
      })
      // "Hide non-matching" removes them from the scene entirely.
      .filter(n => !(filters?.hideNonMatching && n.dimmed))
  }, [snapshot.devices, snapshot.jobs, filters, filtersOn])

  // Focus matches: frame all matching nodes with the camera (positions untouched).
  const [focusReq, setFocusReq] = useState<{ center: [number, number, number]; radius: number; key: number } | null>(null)
  useEffect(() => {
    graphBus.focusMatches = () => {
      const targets = nodes.filter(n => !n.dimmed)
      if (targets.length === 0) return
      const c: [number, number, number] = [0, 0, 0]
      for (const n of targets) { c[0] += n.pos[0]; c[1] += n.pos[1]; c[2] += n.pos[2] }
      c[0] /= targets.length; c[1] /= targets.length; c[2] /= targets.length
      let r = 2
      for (const n of targets) {
        const dx = n.pos[0] - c[0], dy = n.pos[1] - c[1], dz = n.pos[2] - c[2]
        r = Math.max(r, Math.sqrt(dx * dx + dy * dy + dz * dz))
      }
      setFocusReq(prev => ({ center: c, radius: r, key: (prev?.key ?? 0) + 1 }))
    }
    graphBus.fitView = () => {
      setFocusReq(prev => ({ center: [0, 0, 0], radius: 13, key: (prev?.key ?? 0) + 1 }))
    }
    return () => {
      graphBus.focusMatches = undefined
      graphBus.fitView = undefined
    }
  }, [nodes])

  const selectedPos = useMemo<[number, number, number] | null>(() => {
    if (!selectedId) return null
    const n = nodes.find(n => n.id === selectedId)
    return n ? n.pos : null
  }, [selectedId, nodes])

  return (
    <>
      <color attach="background" args={['#020206']} />
      <fog attach="fog" args={['#04040c', 22, 52]} />

      <ambientLight intensity={0.35} />
      <directionalLight position={[10, 12, 8]} intensity={1.0} color="#e8eeff" />
      <directionalLight position={[-8, -4, -10]} intensity={0.25} color="#4fc3f7" />

      <Starfield reduced={reduced} />
      <FloorGrid />

      <CameraRig
        selectedPos={selectedPos}
        autoRotate={autoRotate}
        controlsRef={controlsRef}
        interactedRef={interactedRef}
        focusReq={focusReq}
      />

      <OrchestratorCore
        totalActive={stats.busy}
        totalDevices={stats.total}
        reduced={reduced}
        onClick={() => onNodeSelect('orchestrator')}
      />

      {nodes.map((node, i) => (
        <group key={node.id}>
          <EnergyLink
            to={node.pos}
            status={node.status}
            selected={selectedId === node.id}
            hovered={hoveredId === node.id}
            dimmed={node.dimmed}
          />
          <PhoneNode
            data={node}
            index={i}
            reduced={reduced}
            selected={selectedId === node.id}
            hovered={hoveredId === node.id}
            onSelect={() => onNodeSelect(node.id)}
            onHover={v => setHoveredId(v ? node.id : null)}
            onDoubleClick={() => onNodeDoubleClick(node.id)}
            onRightClick={(x, y) => onContextMenu(node.id, node.name, x, y)}
          />
        </group>
      ))}

      {/* Procedural studio env — local, no CDN fetch, instant load */}
      <Environment resolution={128} frames={1}>
        <Lightformer intensity={2.2} color="#dfe9ff" position={[0, 6, -9]} scale={[12, 4, 1]} />
        <Lightformer intensity={1.2} color="#4fc3f7" position={[-9, 2, 4]} rotation-y={Math.PI / 2} scale={[8, 2, 1]} />
        <Lightformer intensity={0.8} color="#ffffff" position={[9, -2, 4]} rotation-y={-Math.PI / 2} scale={[8, 2, 1]} />
        <Lightformer intensity={0.5} color="#00ff88" position={[0, -7, 0]} rotation-x={Math.PI / 2} scale={[6, 6, 1]} />
      </Environment>
      <Effects />
      <OrbitControls
        ref={controlsRef}
        enablePan
        minDistance={3.5}
        maxDistance={34}
        maxPolarAngle={Math.PI * 0.8}
        dampingFactor={0.08}
        rotateSpeed={0.65}
        enableDamping
        autoRotate={autoRotate}
        autoRotateSpeed={0.25}
        makeDefault
      />
    </>
  )
}

// ─── Context menu ────────────────────────────────────────────────────────────

const CTX_ITEMS = [
  'Launch', 'Control', 'Assign',
  'Add to Group', 'View Logs', 'Reboot', 'Retire',
]

function ContextMenu({ state, onClose }: { state: ContextMenuState; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94 }}
      transition={{ duration: 0.12 }}
      style={{ left: state.x, top: state.y }}
      className="fixed z-50 min-w-[160px] rounded-xl border border-white/[0.08] bg-[#0a0a12]/95 backdrop-blur-xl shadow-2xl overflow-hidden py-1"
    >
      <div className="px-3 py-1.5 border-b border-white/[0.06] mb-1">
        <span className="text-[10px] text-white/30 uppercase tracking-wider font-mono">{state.name}</span>
      </div>
      {CTX_ITEMS.map(item => (
        <button
          key={item}
          onClick={onClose}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors text-left"
        >
          {item}
        </button>
      ))}
    </motion.div>
  )
}

// ─── Fleet health panel — real per-status counts ─────────────────────────────

function FleetHealthBar({ collapsed, onToggle }: {
  collapsed: boolean
  onToggle: () => void
}) {
  const snapshot = useFleet()
  const stats    = useFleetStats()

  const counts = useMemo(() => {
    const c: Record<DeviceStatus, number> = { online: 0, busy: 0, warming: 0, offline: 0, error: 0 }
    for (const d of snapshot?.devices ?? []) c[d.status as DeviceStatus] = (c[d.status as DeviceStatus] ?? 0) + 1
    return c
  }, [snapshot])

  const items = [
    { label: 'Total',   value: stats.total,    color: 'text-white/60' },
    { label: 'Online',  value: counts.online,  color: 'text-[#00ff88]' },
    { label: 'Busy',    value: counts.busy,    color: 'text-[#4fc3f7]' },
    { label: 'Warming', value: counts.warming, color: 'text-[#ffb300]' },
    { label: 'Offline', value: counts.offline, color: 'text-white/30' },
    { label: 'Error',   value: counts.error,   color: 'text-[#ff3b3b]' },
    { label: 'Queue',   value: stats.queue,    color: 'text-white/50' },
  ]
  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20">
      <motion.div
        initial={false}
        animate={{ height: collapsed ? 36 : 'auto' }}
        className="rounded-xl border border-white/[0.08] bg-black/50 backdrop-blur-md overflow-hidden"
      >
        <button
          onClick={onToggle}
          className="w-full flex items-center justify-between gap-6 px-4 py-2"
        >
          <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-white/40">
            <Activity size={10} /> Fleet Status
          </span>
          {collapsed
            ? <ChevronDown size={12} className="text-white/30" />
            : <ChevronUp   size={12} className="text-white/30" />}
        </button>
        {!collapsed && (
          <div className="flex items-center gap-6 px-4 pb-3 flex-wrap">
            {items.map(s => (
              <div key={s.label} className="flex flex-col items-center gap-0.5">
                <span className={['font-mono text-sm font-semibold tabular-nums', s.color].join(' ')}>{s.value}</span>
                <span className="text-[9px] text-white/25 uppercase tracking-wider">{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  )
}

// ─── Camera controls HUD ─────────────────────────────────────────────────────

function CameraHUD({
  onReset, onFitAll, autoRotate, setAutoRotate,
}: {
  onReset: () => void
  onFitAll: () => void
  autoRotate: boolean
  setAutoRotate: (v: boolean) => void
}) {
  return (
    <div className="absolute right-4 top-16 z-20 flex flex-col gap-1.5">
      {[
        { Icon: RotateCcw, label: 'Reset',   onClick: onReset },
        { Icon: Maximize2, label: 'Fit All', onClick: onFitAll },
      ].map(({ Icon, label, onClick }) => (
        <button
          key={label}
          onClick={onClick}
          title={label}
          className="flex items-center justify-center w-8 h-8 rounded-lg border border-white/[0.08] bg-black/40 text-white/45 hover:text-white hover:bg-white/[0.08] backdrop-blur-sm transition-colors"
        >
          <Icon size={13} />
        </button>
      ))}
      <button
        onClick={() => setAutoRotate(!autoRotate)}
        title="Auto-rotate"
        className={[
          'flex items-center justify-center w-8 h-8 rounded-lg border transition-colors backdrop-blur-sm',
          autoRotate
            ? 'border-[#4fc3f7]/40 bg-[#4fc3f7]/15 text-[#7dd3fc]'
            : 'border-white/[0.08] bg-black/40 text-white/30 hover:text-white/60',
        ].join(' ')}
      >
        <Target size={13} />
      </button>
    </div>
  )
}

// ─── Loader ──────────────────────────────────────────────────────────────────

function Loader() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <div className="w-8 h-8 rounded-full border-2 border-[#4fc3f7]/30 border-t-[#4fc3f7] animate-spin" />
      <span className="text-xs text-white/30 font-mono tracking-wider">INITIALISING 3D SCENE</span>
    </div>
  )
}

// ─── Main export ─────────────────────────────────────────────────────────────

class Fleet3DErrorBoundary extends React.Component<React.PropsWithChildren, { err: string | null }> {
  constructor(p: React.PropsWithChildren) { super(p); this.state = { err: null } }
  static getDerivedStateFromError(e: Error) { return { err: e.message } }
  render() {
    if (this.state.err) return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-red-400 font-mono text-xs">3D RENDER ERROR</p>
          <p className="text-white/30 text-xs font-mono">{this.state.err}</p>
          <button onClick={() => this.setState({ err: null })} className="px-4 py-2 text-xs border border-white/20 text-white/60 font-mono hover:border-white/40">RETRY</button>
        </div>
      </div>
    )
    return this.props.children
  }
}

function Fleet3DInner({ filters }: { filters?: FleetFilters }) {
  const openDrawer        = useUIStore(s => s.openDrawer)
  const performanceMode   = useSettings(s => s.performanceMode)
  const forceReduce       = useSettings(s => s.reduceMotion)
  const reduced           = (useReducedMotion() ?? false) || forceReduce

  const [selectedId,  setSelectedId]  = useState<string | null>(null)
  const [hoveredId,   setHoveredId]   = useState<string | null>(null)
  const [autoRotate,  setAutoRotate]  = useState(!reduced)
  const [ctxMenu,     setCtxMenu]     = useState<ContextMenuState | null>(null)
  const [statsCollapsed, setStatsCollapsed] = useState(false)

  const controlsRef   = useRef<OrbitControlsImpl | null>(null)
  const interactedRef = useRef(false)

  const handleUserInteract = useCallback(() => {
    interactedRef.current = true
    setAutoRotate(false)
  }, [])

  const handleNodeSelect = useCallback((id: string) => {
    setSelectedId(prev => prev === id ? null : id)
    setAutoRotate(false)
    if (id !== 'orchestrator') openDrawer(id)
  }, [openDrawer])

  // Double-click matches single click: the shared device sidebar opens first;
  // full phone control is reached through its explicit action.
  const handleDoubleClick = useCallback((id: string) => {
    if (id !== 'orchestrator') openDrawer(id)
  }, [openDrawer])

  const handleReset = useCallback(() => {
    if (!controlsRef.current) return
    controlsRef.current.target.set(0, 0, 0)
    controlsRef.current.object.position.set(...DEFAULT_CAM)
    setSelectedId(null)
    setAutoRotate(true)
  }, [])

  const handleFitAll = useCallback(() => {
    if (!controlsRef.current) return
    controlsRef.current.target.set(0, 0, 0)
    controlsRef.current.object.position.set(0, 9, 20)
    setSelectedId(null)
  }, [])

  // Dismiss context menu on click elsewhere
  useEffect(() => {
    const handler = () => setCtxMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [])

  return (
    <div className="relative w-full h-full" onPointerDown={handleUserInteract}>
      {/* 3D Canvas */}
      <Suspense fallback={<Loader />}>
        <Canvas
          camera={{ position: INTRO_CAM, fov: 50 }}
          dpr={performanceMode === 'full' ? [1, 2] : [1, 1.25]}
          gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
          style={{ background: '#020206' }}
        >
          <Scene
            onNodeSelect={handleNodeSelect}
            onNodeDoubleClick={handleDoubleClick}
            onContextMenu={(nodeId, name, x, y) => setCtxMenu({ nodeId, name, x, y })}
            selectedId={selectedId}
            hoveredId={hoveredId}
            setHoveredId={setHoveredId}
            autoRotate={autoRotate}
            controlsRef={controlsRef}
            interactedRef={interactedRef}
            reduced={reduced}
            filters={filters}
          />
        </Canvas>
      </Suspense>

      {/* Cinematic vignette */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{ background: 'radial-gradient(ellipse at center, transparent 52%, rgba(0,0,0,0.5) 100%)' }}
      />

      {/* Fleet status bar */}
      <FleetHealthBar
        collapsed={statsCollapsed}
        onToggle={() => setStatsCollapsed(p => !p)}
      />

      {/* Camera HUD */}
      <CameraHUD
        onReset={handleReset}
        onFitAll={handleFitAll}
        autoRotate={autoRotate}
        setAutoRotate={setAutoRotate}
      />

      {/* Context menu */}
      <AnimatePresence>
        {ctxMenu && <ContextMenu state={ctxMenu} onClose={() => setCtxMenu(null)} />}
      </AnimatePresence>

      {/* Help hint */}
      <div className="absolute bottom-4 right-4 z-10 flex items-center gap-3 text-[10px] text-white/15 font-mono">
        <span>DRAG to rotate</span>
        <span>SCROLL to zoom</span>
        <span>CLICK to select</span>
        <span>DBL-CLICK to control</span>
      </div>
    </div>
  )
}

export function Fleet3D({ filters }: { filters?: FleetFilters }) {
  return (
    <Fleet3DErrorBoundary>
      <Fleet3DInner filters={filters} />
    </Fleet3DErrorBoundary>
  )
}
