import { useRef, useState, useMemo, Suspense } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Text, Billboard, Sphere, MeshDistortMaterial } from '@react-three/drei'
import * as THREE from 'three'
import { useFleet } from '@/hooks/use-fleet'
import { useUIStore } from '@/state/ui-store'

// ── Status color map ────────────────────────────────────────────────────────
const STATUS_COLOR: Record<string, string> = {
  online:  '#22c55e',
  running: '#818cf8',
  warning: '#f59e0b',
  offline: '#6b7280',
  booting: '#38bdf8',
}

// ── Orchestrator node ────────────────────────────────────────────────────────
function OrchestratorNode() {
  const meshRef = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = clock.getElapsedTime() * 0.3
      meshRef.current.rotation.x = Math.sin(clock.getElapsedTime() * 0.2) * 0.1
    }
  })
  return (
    <group>
      {/* Outer ring */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.8, 0.02, 8, 64]} />
        <meshBasicMaterial color="#6366f1" opacity={0.4} transparent />
      </mesh>
      <mesh rotation={[Math.PI / 3, 0, 0]}>
        <torusGeometry args={[1.8, 0.015, 8, 64]} />
        <meshBasicMaterial color="#6366f1" opacity={0.2} transparent />
      </mesh>
      {/* Core sphere */}
      <Sphere ref={meshRef} args={[0.55, 32, 32]}>
        <MeshDistortMaterial
          color="#4f46e5"
          distort={0.25}
          speed={2}
          roughness={0.1}
          metalness={0.8}
        />
      </Sphere>
      {/* Glow */}
      <pointLight color="#6366f1" intensity={3} distance={5} decay={2} />
      <Billboard>
        <Text
          fontSize={0.25}
          color="#e0e7ff"
          anchorX="center"
          anchorY="middle"
          position={[0, -0.9, 0]}
          font={undefined}
        >
          ORCHESTRATOR
        </Text>
      </Billboard>
    </group>
  )
}

// ── Connection line ──────────────────────────────────────────────────────────
function ConnectionLine({ from, to, color }: { from: THREE.Vector3; to: THREE.Vector3; color: string }) {
  const obj = useMemo(() => {
    const geom = new THREE.BufferGeometry().setFromPoints([from, to])
    const mat  = new THREE.LineBasicMaterial({ color, opacity: 0.15, transparent: true })
    return new THREE.Line(geom, mat)
  }, [from, to, color])
  return <primitive object={obj} />
}

// ── Phone node ───────────────────────────────────────────────────────────────
function PhoneNode({
  position,
  status,
  name,
  onSelect,
  selected,
}: {
  position: [number, number, number]
  status: string
  name: string
  onSelect: () => void
  selected: boolean
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const [hovered, setHovered] = useState(false)
  const color = STATUS_COLOR[status] ?? '#6b7280'

  useFrame(({ clock }) => {
    if (!meshRef.current) return
    const t = clock.getElapsedTime()
    meshRef.current.position.y = position[1] + Math.sin(t * 0.8 + position[0]) * 0.06
    const targetScale = selected ? 1.5 : hovered ? 1.3 : 1
    meshRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.12)
  })

  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        onClick={(e) => { e.stopPropagation(); onSelect() }}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        <boxGeometry args={[0.22, 0.38, 0.04]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={hovered || selected ? 1.2 : 0.4}
          roughness={0.2}
          metalness={0.7}
        />
      </mesh>
      {/* Screen glow */}
      <pointLight color={color} intensity={hovered ? 2 : selected ? 3 : 0.6} distance={1.5} decay={2} />
      {(hovered || selected) && (
        <Billboard>
          <Text
            fontSize={0.12}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
            position={[0, 0.35, 0]}
            font={undefined}
          >
            {name}
          </Text>
        </Billboard>
      )}
    </group>
  )
}

// ── Scene ────────────────────────────────────────────────────────────────────
function Scene() {
  const snapshot = useFleet()
  const openDrawer = useUIStore(s => s.openDrawer)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  useThree()

  // Position phones in layered spherical shells
  const nodePositions = useMemo(() => {
    const devices = snapshot.devices ?? []
    return devices.map((d, i) => {
      const shell = Math.floor(i / 12)         // 0=inner, 1=mid, 2=outer
      const radius = 3.5 + shell * 2.2
      const ySpread = 1.8 + shell * 0.8
      const angle = (i % 12) * (Math.PI * 2 / 12) + shell * 0.4
      const elevation = ((i % 5) - 2) * (ySpread / 4)
      return {
        id: d.id,
        name: d.id.replace('phone-', 'P'),
        status: d.status ?? 'offline',
        pos: [
          Math.cos(angle) * radius,
          elevation,
          Math.sin(angle) * radius,
        ] as [number, number, number],
      }
    })
  }, [snapshot.devices])

  const origin = useMemo(() => new THREE.Vector3(0, 0, 0), [])

  return (
    <>
      {/* Ambient & directional */}
      <ambientLight intensity={0.15} />
      <directionalLight position={[10, 10, 5]} intensity={0.4} color="#e0e7ff" />
      <directionalLight position={[-10, -5, -5]} intensity={0.1} color="#818cf8" />

      {/* Grid floor */}
      <gridHelper args={[40, 40, '#1e1b4b', '#1e1b4b']} position={[0, -3.5, 0]} />

      {/* Depth fog */}
      <fog attach="fog" args={['#070712', 14, 32]} />

      {/* Center orchestrator */}
      <OrchestratorNode />

      {/* Phone nodes + connections */}
      {nodePositions.map(node => {
        const pos3 = new THREE.Vector3(...node.pos)
        return (
          <group key={node.id}>
            <ConnectionLine
              from={origin}
              to={pos3}
              color={STATUS_COLOR[node.status] ?? '#6b7280'}
            />
            <PhoneNode
              position={node.pos}
              status={node.status}
              name={node.name}
              selected={selectedId === node.id}
              onSelect={() => {
                setSelectedId(node.id)
                openDrawer(node.id)
              }}
            />
          </group>
        )
      })}

      <OrbitControls
        enablePan={false}
        minDistance={5}
        maxDistance={22}
        autoRotate
        autoRotateSpeed={0.25}
        dampingFactor={0.08}
        enableDamping
      />
    </>
  )
}

// ── Loading fallback ─────────────────────────────────────────────────────────
function Loader() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <div className="w-8 h-8 rounded-full border-2 border-indigo-500/30 border-t-indigo-500 animate-spin" />
      <span className="text-xs text-white/30">Initialising 3D scene…</span>
    </div>
  )
}

// ── Main export ──────────────────────────────────────────────────────────────
export function Fleet3D() {
  return (
    <div className="w-full h-full">
      <Suspense fallback={<Loader />}>
        <Canvas
          camera={{ position: [0, 4, 12], fov: 55 }}
          gl={{ antialias: true, alpha: true }}
          style={{ background: 'transparent' }}
        >
          <Scene />
        </Canvas>
      </Suspense>
    </div>
  )
}
