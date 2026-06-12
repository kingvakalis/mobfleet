import {
  useRef, useState, useMemo, useCallback, useEffect, Suspense,
} from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Billboard, Text, Sphere, Environment } from '@react-three/drei'
// @ts-ignore
import { EffectComposer, Bloom, ChromaticAberration, Vignette } from '@react-three/postprocessing'
// @ts-ignore
import { BlendFunction } from 'postprocessing'
import { Vector2 } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import * as THREE from 'three'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Maximize2, RotateCcw, Focus, Target,
  Cpu, Activity,
  ChevronDown, ChevronUp,
} from 'lucide-react'
import { useFleet, useFleetStats } from '@/hooks/use-fleet'
import { useUIStore } from '@/state/ui-store'

// ─── Constants ─────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  online:  '#22c55e',
  running: '#3b82f6',
  warning: '#f59e0b',
  offline: '#ef4444',
  booting: '#94a3b8',
}
const STATUS_HEX: Record<string, number> = {
  online:  0x22c55e,
  running: 0x3b82f6,
  warning: 0xf59e0b,
  offline: 0xef4444,
  booting: 0x94a3b8,
}
const DEFAULT_CAM: [number, number, number] = [0, 5, 15]

// ─── Types ──────────────────────────────────────────────────────────────────

interface NodeData {
  id: string
  name: string
  status: string
  pos: [number, number, number]
  group?: string
  job?: string
}

interface ContextMenuState {
  nodeId: string
  x: number
  y: number
}

// ─── Shared geometry / material cache ───────────────────────────────────────

const PHONE_GEO  = new THREE.BoxGeometry(0.26, 0.46, 0.06, 1, 1, 1)
const SCREEN_GEO = new THREE.PlaneGeometry(0.20, 0.34)
const NOTCH_GEO  = new THREE.CapsuleGeometry(0.012, 0.04, 4, 8)
const BUTTON_GEO = new THREE.CapsuleGeometry(0.005, 0.05, 4, 8)
const RING_GEO   = new THREE.TorusGeometry(0.22, 0.012, 8, 64)

// ─── Particle along a line ───────────────────────────────────────────────────

function LineParticle({
  from, to, color, speed, active,
}: {
  from: THREE.Vector3; to: THREE.Vector3
  color: THREE.Color; speed: number; active: boolean
}) {
  const ref = useRef<THREE.Mesh>(null)
  const t   = useRef(Math.random())

  useFrame((_, dt) => {
    if (!ref.current || !active) return
    t.current = (t.current + dt * speed) % 1
    ref.current.position.lerpVectors(from, to, t.current)
  })

  if (!active) return null
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.04, 6, 6]} />
      <meshBasicMaterial color={color} transparent opacity={0.8} />
    </mesh>
  )
}

// ─── Connection line ─────────────────────────────────────────────────────────

function ConnectionLine({
  from, to, status, selected, hovered,
}: {
  from: THREE.Vector3; to: THREE.Vector3
  status: string; selected: boolean; hovered: boolean
}) {
  const lineRef = useRef<THREE.Line>(null)
  const geom    = useMemo(() => new THREE.BufferGeometry().setFromPoints([from, to]), [from, to])
  const color   = useMemo(() => new THREE.Color(STATUS_COLOR[status] ?? '#6b7280'), [status])
  const particleColor = useMemo(() => new THREE.Color(STATUS_COLOR[status] ?? '#818cf8'), [status])

  const active  = status === 'online' || status === 'running'
  const opacity = selected ? 0.9 : hovered ? 0.6 : active ? 0.18 : 0.06

  useFrame(() => {
    if (!lineRef.current) return
    const mat = lineRef.current.material as THREE.LineBasicMaterial
    mat.opacity = THREE.MathUtils.lerp(mat.opacity, opacity, 0.08)
  })

  const mat = useMemo(
    () => new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.1 }),
    [color],
  )
  const lineObj = useMemo(() => new THREE.Line(geom, mat), [geom, mat])

  return (
    <>
      <primitive ref={lineRef} object={lineObj} />
      {[0.0, 0.33, 0.66].map(offset => (
        <LineParticle
          key={offset}
          from={from}
          to={to}
          color={particleColor}
          speed={selected ? 0.6 : active ? 0.25 : 0.0}
          active={active || selected}
        />
      ))}
    </>
  )
}

// ─── Phone node ──────────────────────────────────────────────────────────────

function PhoneNode({
  data, selected, hovered,
  onSelect, onHover, onDoubleClick, onRightClick,
}: {
  data: NodeData
  selected: boolean
  hovered:  boolean
  onSelect:      () => void
  onHover:       (v: boolean) => void
  onDoubleClick: () => void
  onRightClick:  (x: number, y: number) => void
}) {
  const groupRef = useRef<THREE.Group>(null)
  const ringRef  = useRef<THREE.Mesh>(null)
  const glowRef  = useRef<THREE.PointLight>(null)
  const color    = STATUS_HEX[data.status] ?? 0x6b7280
  // Float animation
  const floatOff = useMemo(() => Math.random() * Math.PI * 2, [])

  useFrame(({ clock }) => {
    if (!groupRef.current) return
    const t = clock.getElapsedTime()

    // Float
    const targetY = data.pos[1]
      + Math.sin(t * 0.7 + floatOff) * 0.06
      + (selected ? 0.35 : hovered ? 0.18 : 0)
    groupRef.current.position.y = THREE.MathUtils.lerp(
      groupRef.current.position.y, targetY, 0.06,
    )

    // Tilt toward camera on hover
    const targetTilt = hovered ? 0.18 : 0
    groupRef.current.rotation.x = THREE.MathUtils.lerp(
      groupRef.current.rotation.x, targetTilt, 0.08,
    )

    // Scale
    const targetScale = selected ? 1.35 : hovered ? 1.15 : 1
    groupRef.current.scale.setScalar(
      THREE.MathUtils.lerp(groupRef.current.scale.x, targetScale, 0.1),
    )

    // Ring
    if (ringRef.current) {
      ringRef.current.rotation.z = t * (selected ? 1.5 : 0.4)
      const mat = ringRef.current.material as THREE.MeshBasicMaterial
      mat.opacity = selected ? 0.85 : hovered ? 0.4 : 0
    }

    // Glow
    if (glowRef.current) {
      const targetI = selected ? 5 : hovered ? 3 : 0.8
      glowRef.current.intensity = THREE.MathUtils.lerp(glowRef.current.intensity, targetI, 0.1)
    }
  })

  return (
    <group
      ref={groupRef}
      position={data.pos}
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
      {/* Body */}
      <mesh geometry={PHONE_GEO} castShadow>
        <meshPhysicalMaterial
          color={'#1a1a2e'}
          roughness={0.15}
          metalness={0.9}
          clearcoat={1}
          clearcoatRoughness={0.1}
          emissive={new THREE.Color(color)}
          emissiveIntensity={selected ? 0.8 : hovered ? 0.4 : 0.12}
        />
      </mesh>

      {/* Screen */}
      <mesh geometry={SCREEN_GEO} position={[0, 0, 0.032]}>
        <meshStandardMaterial
          color={selected ? color : hovered ? 0x1e1e2e : 0x0a0a12}
          roughness={0.0}
          metalness={0.0}
          emissive={color}
          emissiveIntensity={selected ? 0.6 : hovered ? 0.3 : 0.08}
        />
      </mesh>

      {/* Notch */}
      <mesh geometry={NOTCH_GEO} position={[0, 0.19, 0.034]} rotation={[0, 0, Math.PI / 2]}>
        <meshBasicMaterial color={0x000000} />
      </mesh>

      {/* Side button */}
      <mesh geometry={BUTTON_GEO} position={[0.14, 0.06, 0]} rotation={[0, 0, Math.PI / 2]}>
        <meshStandardMaterial color={0x1a1a28} roughness={0.3} metalness={0.9} />
      </mesh>

      {/* Status light */}
      <mesh position={[0.07, -0.18, 0.034]}>
        <sphereGeometry args={[0.018, 8, 8]} />
        <meshBasicMaterial color={color} />
      </mesh>

      {/* Selection ring */}
      <mesh ref={ringRef} geometry={RING_GEO} rotation={[Math.PI / 2, 0, 0]}>
        <meshBasicMaterial color={color} transparent opacity={0} side={THREE.DoubleSide} />
      </mesh>

      {/* Glow light */}
      <pointLight ref={glowRef} color={color} intensity={0.8} distance={2.5} decay={2} />

      {/* Screen reflection glare */}
      <mesh position={[-0.04, 0.08, 0.033]}>
        <planeGeometry args={[0.06, 0.12]} />
        <meshBasicMaterial color={0xffffff} transparent opacity={0.04} />
      </mesh>

      {/* Label */}
      <Billboard position={[0, 0.38, 0]}>
        <Text
          fontSize={hovered || selected ? 0.13 : 0.09}
          color={selected ? '#ffffff' : hovered ? '#e0e7ff' : '#94a3b8'}
          anchorX="center"
          anchorY="middle"
          font={undefined}
          maxWidth={1.2}
        >
          {data.name.replace('iPhone-', 'P')}
        </Text>
        {(hovered || selected) && (
          <Text
            fontSize={0.085}
            color={STATUS_COLOR[data.status] ?? '#94a3b8'}
            anchorX="center"
            anchorY="middle"
            position={[0, -0.16, 0]}
            font={undefined}
          >
            {data.status.toUpperCase()} {data.job ? '· ' + data.job : ''}
          </Text>
        )}
      </Billboard>
    </group>
  )
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

function OrchestratorNode({
  totalActive, totalDevices, onClick,
}: {
  totalActive: number; totalDevices: number; onClick: () => void
}) {
  const coreRef  = useRef<THREE.Mesh>(null)
  const ring1Ref = useRef<THREE.Mesh>(null)
  const ring2Ref = useRef<THREE.Mesh>(null)
  const ring3Ref = useRef<THREE.Mesh>(null)
  const pulseRef = useRef<THREE.Mesh>(null)
  const [hovered, setHovered] = useState(false)

  const activityRatio = totalDevices > 0 ? totalActive / totalDevices : 0

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    if (ring1Ref.current) ring1Ref.current.rotation.y = t * 0.18
    if (ring2Ref.current) ring2Ref.current.rotation.x = -t * 0.12
    if (ring3Ref.current) {
      ring3Ref.current.rotation.z = t * 0.22
      ring3Ref.current.rotation.y = t * 0.09
    }
    if (coreRef.current) {
      const pulse = 1 + Math.sin(t * (1.2 + activityRatio * 2)) * 0.05
      coreRef.current.scale.setScalar(pulse)
    }
    if (pulseRef.current) {
      const mat = pulseRef.current.material as THREE.MeshBasicMaterial
      mat.opacity = (Math.sin(t * 1.5) * 0.5 + 0.5) * (hovered ? 0.25 : 0.1)
      pulseRef.current.scale.setScalar(1 + Math.sin(t * 1.5) * 0.12)
    }
  })

  return (
    <group
      onClick={(e) => { e.stopPropagation(); onClick() }}
      onPointerEnter={() => { setHovered(true);  document.body.style.cursor = 'pointer' }}
      onPointerLeave={() => { setHovered(false); document.body.style.cursor = 'default' }}
    >
      {/* Pulse sphere */}
      <mesh ref={pulseRef}>
        <sphereGeometry args={[1.1, 16, 16]} />
        <meshBasicMaterial color="#6366f1" transparent opacity={0.08} side={THREE.BackSide} />
      </mesh>

      {/* Rings */}
      <mesh ref={ring1Ref}>
        <torusGeometry args={[1.6, 0.018, 8, 80]} />
        <meshBasicMaterial color="#6366f1" transparent opacity={0.35} />
      </mesh>
      <mesh ref={ring2Ref}>
        <torusGeometry args={[2.1, 0.012, 8, 80]} />
        <meshBasicMaterial color="#4f46e5" transparent opacity={0.2} />
      </mesh>
      <mesh ref={ring3Ref}>
        <torusGeometry args={[1.35, 0.008, 8, 80]} />
        <meshBasicMaterial color="#818cf8" transparent opacity={0.15} />
      </mesh>

      {/* Core */}
      <Sphere ref={coreRef} args={[0.55, 32, 32]}>
        <meshStandardMaterial
          color="#1e1b4b"
          roughness={0.05}
          metalness={0.9}
          emissive="#4f46e5"
          emissiveIntensity={hovered ? 0.7 : 0.35}
        />
      </Sphere>

      {/* Central light */}
      <pointLight color="#6366f1" intensity={hovered ? 6 : 3} distance={6} decay={2} />

      {/* Status arc glow */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.72, 0.04, 4, 48, Math.PI * 2 * activityRatio]} />
        <meshBasicMaterial color="#22c55e" transparent opacity={0.6} />
      </mesh>

      <Billboard position={[0, -0.85, 0]}>
        <Text fontSize={0.18} color="#e0e7ff" anchorX="center" anchorY="middle" font={undefined}>
          ORCHESTRATOR
        </Text>
        {hovered && (
          <Text fontSize={0.12} color="#94a3b8" anchorX="center" anchorY="middle" position={[0, -0.22, 0]} font={undefined}>
            {totalActive}/{totalDevices} ACTIVE
          </Text>
        )}
      </Billboard>
    </group>
  )
}

// ─── Camera controller ───────────────────────────────────────────────────────

function CameraController({
  selectedPos, autoRotate, controlsRef,
}: {
  selectedPos: [number, number, number] | null
  autoRotate: boolean
  controlsRef: React.RefObject<OrbitControlsImpl | null>
}) {
  const { camera } = useThree()

  useFrame(() => {
    if (selectedPos && controlsRef.current) {
      const target = new THREE.Vector3(...selectedPos)
      controlsRef.current.target.lerp(target, 0.05)
      const desired = new THREE.Vector3(
        selectedPos[0] * 0.3 + camera.position.x * 0.1,
        selectedPos[1] + 2,
        selectedPos[2] * 0.3 + 8,
      )
      camera.position.lerp(desired, 0.04)
    }
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate
    }
  })

  return null
}

// ─── Scene ───────────────────────────────────────────────────────────────────

function Scene({
  onNodeSelect, onNodeDoubleClick, onContextMenu, selectedId, hoveredId,
  setHoveredId, autoRotate, controlsRef,
}: {
  onNodeSelect:      (id: string) => void
  onNodeDoubleClick: (id: string) => void
  onContextMenu:     (nodeId: string, x: number, y: number) => void
  selectedId:  string | null
  hoveredId:   string | null
  setHoveredId:(id: string | null) => void
  autoRotate:  boolean
  controlsRef: React.RefObject<OrbitControlsImpl | null>
}) {
  const snapshot = useFleet()
  const stats    = useFleetStats()

  const nodes = useMemo<NodeData[]>(() => {
    return (snapshot.devices ?? []).map((d, i) => {
      const shell  = Math.floor(i / 10)
      const radius = 4.5 + shell * 2.4
      const count  = Math.min(10, snapshot.devices.length - shell * 10)
      const angle  = (i % count) * (Math.PI * 2 / count) + shell * 0.5
      const elev   = ((i % 7) - 3) * 0.9
      return {
        id:     d.id,
        name:   d.id,
        status: d.status ?? 'offline',
        job:    (d as unknown as Record<string, unknown>).job as string | undefined,
        group:  d.group,
        pos:    [
          Math.cos(angle) * radius,
          elev,
          Math.sin(angle) * radius,
        ],
      }
    })
  }, [snapshot.devices])

  const selectedPos = useMemo<[number,number,number] | null>(() => {
    if (!selectedId) return null
    const n = nodes.find(n => n.id === selectedId)
    return n ? n.pos : null
  }, [selectedId, nodes])

  const origin = useMemo(() => new THREE.Vector3(0, 0, 0), [])

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[12, 10, 6]} intensity={1.2} color="#dde4ff" />
      <directionalLight position={[-10, -6, -8]} intensity={0.4} color="#818cf8" />
      <pointLight position={[0, 8, 0]} intensity={0.8} color="#a5b4fc" distance={30} decay={2} />
      <fog attach="fog" args={['#070712', 18, 38]} />
      <gridHelper args={[50, 50, '#1a1a2e', '#1a1a2e']} position={[0, -4, 0]} />

      <CameraController
        selectedPos={selectedPos}
        autoRotate={autoRotate}
        controlsRef={controlsRef}
      />

      <OrchestratorNode
        totalActive={stats.busy}
        totalDevices={stats.total}
        onClick={() => onNodeSelect('orchestrator')}
      />

      {nodes.map(node => {
        const fromVec = origin
        const toVec   = new THREE.Vector3(...node.pos)
        return (
          <group key={node.id}>
            <ConnectionLine
              from={fromVec}
              to={toVec}
              status={node.status}
              selected={selectedId === node.id}
              hovered={hoveredId === node.id}
            />
            <PhoneNode
              data={node}
              selected={selectedId === node.id}
              hovered={hoveredId === node.id}
              onSelect={() => onNodeSelect(node.id)}
              onHover={v => setHoveredId(v ? node.id : null)}
              onDoubleClick={() => onNodeDoubleClick(node.id)}
              onRightClick={(x, y) => onContextMenu(node.id, x, y)}
            />
          </group>
        )
      })}

      <Environment preset="city" />
      <EffectComposer>
        <Bloom
          intensity={0.4}
          luminanceThreshold={0.6}
          luminanceSmoothing={0.9}
          mipmapBlur
        />
        <ChromaticAberration
          blendFunction={BlendFunction.NORMAL}
          offset={new Vector2(0.0005, 0.0005)}
        />
        <Vignette eskil={false} offset={0.1} darkness={0.6} />
      </EffectComposer>
      <OrbitControls
        ref={controlsRef}
        enablePan
        minDistance={4}
        maxDistance={28}
        maxPolarAngle={Math.PI * 0.78}
        dampingFactor={0.09}
        enableDamping
        autoRotate={autoRotate}
        autoRotateSpeed={0.3}
        makeDefault
      />
    </>
  )
}

// ─── Context menu ────────────────────────────────────────────────────────────

const CTX_ITEMS = [
  'Launch', 'Control', 'Assign', 'Change Proxy',
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
      className="fixed z-50 min-w-[160px] rounded-xl border border-white/[0.08] bg-[#0e0e18]/95 backdrop-blur-xl shadow-2xl overflow-hidden py-1"
    >
      <div className="px-3 py-1.5 border-b border-white/[0.06] mb-1">
        <span className="text-[10px] text-white/30 uppercase tracking-wider font-mono">{state.nodeId.replace('phone-', 'P')}</span>
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

// ─── Fleet health panel ───────────────────────────────────────────────────────

function FleetHealthBar({ stats, collapsed, onToggle }: {
  stats: ReturnType<typeof useFleetStats>
  collapsed: boolean
  onToggle: () => void
}) {
  const items = [
    { label: 'Total',   value: stats.total,                                    color: 'text-white/60' },
    { label: 'Online',  value: stats.busy,                                     color: 'text-emerald-400' },
    { label: 'Idle',    value: stats.idle,                                     color: 'text-blue-400' },
    { label: 'Warning', value: Math.max(0, stats.total - stats.busy - stats.idle - 2), color: 'text-amber-400' },
    { label: 'Offline', value: 2,                                              color: 'text-red-400' },
    { label: 'Jobs',    value: stats.busy,                                     color: 'text-indigo-400' },
    { label: 'Latency', value: '42ms',                                         color: 'text-cyan-400' },
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
                <span className={['font-mono text-sm font-semibold', s.color].join(' ')}>{s.value}</span>
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
  onReset, onFitAll, onFocusSelected, selectedId, autoRotate, setAutoRotate,
}: {
  onReset: () => void
  onFitAll: () => void
  onFocusSelected: () => void
  selectedId: string | null
  autoRotate: boolean
  setAutoRotate: (v: boolean) => void
}) {
  return (
    <div className="absolute right-4 top-4 z-20 flex flex-col gap-1.5">
      {[
        { Icon: RotateCcw, label: 'Reset',  onClick: onReset },
        { Icon: Maximize2, label: 'Fit All', onClick: onFitAll },
        { Icon: Focus,     label: 'Focus',  onClick: onFocusSelected, disabled: !selectedId },
      ].map(({ Icon, label, onClick, disabled }) => (
        <button
          key={label}
          onClick={onClick}
          disabled={disabled}
          title={label}
          className={[
            'flex items-center justify-center w-8 h-8 rounded-lg border transition-colors',
            disabled
              ? 'border-white/[0.04] bg-black/20 text-white/15 cursor-not-allowed'
              : 'border-white/[0.08] bg-black/40 text-white/45 hover:text-white hover:bg-white/[0.08] backdrop-blur-sm',
          ].join(' ')}
        >
          <Icon size={13} />
        </button>
      ))}
      <button
        onClick={() => setAutoRotate(!autoRotate)}
        title="Auto-rotate"
        className={[
          'flex items-center justify-center w-8 h-8 rounded-lg border transition-colors',
          autoRotate
            ? 'border-indigo-500/40 bg-indigo-600/20 text-indigo-400'
            : 'border-white/[0.08] bg-black/40 text-white/30 hover:text-white/60 backdrop-blur-sm',
        ].join(' ')}
      >
        <Target size={13} />
      </button>
    </div>
  )
}

// ─── Selected device panel ───────────────────────────────────────────────────

function SelectedPanel({
  nodeId, onControl, onClose,
}: {
  nodeId: string; onControl: () => void; onClose: () => void
}) {
  const snapshot = useFleet()
  const d = snapshot.devices.find(x => x.id === nodeId)
  if (!d) return null

  const statusColor = STATUS_COLOR[d.status] ?? '#6b7280'

  return (
    <motion.div
      key={nodeId}
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.2 }}
      className="absolute left-4 bottom-4 z-20 w-56"
    >
      <div className="rounded-xl border border-white/[0.08] bg-black/60 backdrop-blur-xl p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: statusColor }} />
            <span className="text-xs font-semibold text-white/85">{d.id.replace('phone-', 'P-')}</span>
          </span>
          <button onClick={onClose} className="text-white/25 hover:text-white/70 text-lg leading-none">×</button>
        </div>
        <div className="grid grid-cols-2 gap-1 text-[10px]">
          {[
            ['Status', d.status],
            ['Group',  d.group ?? '—'],
          ].map(([k, v]) => (
            <div key={k}>
              <div className="text-white/25">{k}</div>
              <div className="text-white/70 font-mono">{v}</div>
            </div>
          ))}
        </div>
        <button
          onClick={onControl}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-indigo-600/25 hover:bg-indigo-600/40 text-indigo-300 text-xs transition-colors border border-indigo-500/20"
        >
          <Cpu size={11} /> Control Device
        </button>
      </div>
    </motion.div>
  )
}

// ─── Loader ───────────────────────────────────────────────────────────────────

function Loader() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <div className="w-8 h-8 rounded-full border-2 border-indigo-500/30 border-t-indigo-500 animate-spin" />
      <span className="text-xs text-white/30">Initialising 3D Scene…</span>
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function Fleet3D() {
  const stats      = useFleetStats()
  const openDrawer        = useUIStore(s => s.openDrawer)
  const setView           = useUIStore(s => s.setView)
  const openPhoneControl  = useUIStore(s => s.openPhoneControl)

  const [selectedId,  setSelectedId]  = useState<string | null>(null)
  const [hoveredId,   setHoveredId]   = useState<string | null>(null)
  const [autoRotate,  setAutoRotate]  = useState(true)
  const [ctxMenu,     setCtxMenu]     = useState<ContextMenuState | null>(null)
  const [statsCollapsed, setStatsCollapsed] = useState(false)

  const controlsRef = useRef<OrbitControlsImpl | null>(null)

  // Stop auto-rotate on interaction
  const handleUserInteract = useCallback(() => setAutoRotate(false), [])

  const handleNodeSelect = useCallback((id: string) => {
    setSelectedId(prev => prev === id ? null : id)
    setAutoRotate(false)
    if (id !== 'orchestrator') openDrawer(id)
  }, [openDrawer])

  const handleDoubleClick = useCallback((id: string) => {
    openPhoneControl(id)
  }, [openPhoneControl])

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
    controlsRef.current.object.position.set(0, 8, 18)
    setSelectedId(null)
  }, [])

  const handleFocusSelected = useCallback(() => {
    // CameraController handles smooth lerp when selectedPos is set
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
          camera={{ position: DEFAULT_CAM, fov: 52 }}
          gl={{ antialias: true, alpha: true }}
          shadows
          style={{ background: 'transparent' }}
        >
          <Scene
            onNodeSelect={handleNodeSelect}
            onNodeDoubleClick={handleDoubleClick}
            onContextMenu={(nodeId, x, y) => setCtxMenu({ nodeId, x, y })}
            selectedId={selectedId}
            hoveredId={hoveredId}
            setHoveredId={setHoveredId}
            autoRotate={autoRotate}
            controlsRef={controlsRef}
          />
        </Canvas>
      </Suspense>

      {/* Fleet status bar */}
      <FleetHealthBar
        stats={stats}
        collapsed={statsCollapsed}
        onToggle={() => setStatsCollapsed(p => !p)}
      />

      {/* Camera HUD */}
      <CameraHUD
        onReset={handleReset}
        onFitAll={handleFitAll}
        onFocusSelected={handleFocusSelected}
        selectedId={selectedId}
        autoRotate={autoRotate}
        setAutoRotate={setAutoRotate}
      />

      {/* Selected panel */}
      <AnimatePresence>
        {selectedId && selectedId !== 'orchestrator' && (
          <SelectedPanel
            nodeId={selectedId}
            onControl={() => { setView('phones'); openDrawer(selectedId) }}
            onClose={() => setSelectedId(null)}
          />
        )}
      </AnimatePresence>

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
