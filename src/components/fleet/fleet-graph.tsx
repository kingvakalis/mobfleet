import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type OnSelectionChangeParams,
  type Viewport,
} from '@xyflow/react'
import { AnimatePresence, useReducedMotion } from 'framer-motion'
import '@xyflow/react/dist/style.css'
import { useFleet } from '@/hooks/use-fleet'
import { client } from '@/lib/provider'
import { graphBus } from '@/lib/graph-bus'
import { useUIStore, fleetFiltersActive, type FleetFilters } from '@/state/ui-store'
import { useSettings, motionDisabled } from '@/state/settings-store'
import {
  hasWarped, positionFor, savePosition,
  orchestratorPos, saveOrchestratorPos,
  savedViewport, saveViewport,
} from '@/lib/layout/constellation'
import { FleetForceSim } from '@/lib/layout/force-sim'
import { matchesDevice, groupColor } from '@/lib/fleet-filtering'
import type { Device, Job } from '@/lib/provider/types'
import { DeviceNode, NODE_H, NODE_W, type DeviceNodeData } from './device-node'
import { CORE_SIZE, OrchestratorNode } from './orchestrator-node'
import { PulseEdge } from './pulse-edge'
import { GraphControls } from './graph-controls'
import { BulkActionBar } from './bulk-action-bar'

const nodeTypes = { device: DeviceNode, orchestrator: OrchestratorNode }
const edgeTypes = { pulse: PulseEdge }

/** Dissolve duration — a retired node lingers this long before it's dropped. */
const DISSOLVE_MS = 420

function makeOrchestrator(): Node {
  const p = orchestratorPos()
  return {
    id: 'orchestrator',
    type: 'orchestrator',
    position: { x: p.x - CORE_SIZE / 2, y: p.y - CORE_SIZE / 2 },
    data: {},
    selectable: false,
  }
}

function deviceNode(d: Device, job: Job | null, opts: Partial<DeviceNodeData>): Node {
  const p = positionFor(d.id)
  const data: DeviceNodeData = { device: d, job, pos: p, ...opts }
  return {
    id: d.id,
    type: 'device',
    position: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 },
    data,
  }
}

function Graph({ filters, locked }: { filters: FleetFilters; locked: boolean }) {
  const snapshot = useFleet()
  const { fitView } = useReactFlow()
  const filtersOn = fleetFiltersActive(filters)

  const jobsById = useMemo(() => {
    const m = new Map<string, Job>()
    for (const j of snapshot.jobs) m.set(j.id, j)
    return m
  }, [snapshot.jobs])

  const matches = useCallback(
    (d: Device): boolean => matchesDevice(filters, d, d.jobId ? jobsById.get(d.jobId) ?? null : null),
    [filters, jobsById],
  )

  const matchingIds = useMemo(
    () => snapshot.devices.filter(matches).map((d) => d.id),
    [snapshot.devices, matches],
  )

  // Expose fit-to-screen + focus-matches to the command palette / filter bar.
  useEffect(() => {
    graphBus.fitView = () => void fitView({ padding: 0.28, duration: 400 })
    graphBus.focusMatches = () => {
      if (matchingIds.length === 0) return
      void fitView({ nodes: matchingIds.map((id) => ({ id })), padding: 0.3, duration: 500 })
    }
    return () => {
      graphBus.fitView = undefined
      graphBus.focusMatches = undefined
    }
  }, [fitView, matchingIds])

  const buildAll = useCallback((): Node[] => {
    const list: Node[] = [makeOrchestrator()]
    for (const d of snapshot.devices) {
      const job = d.jobId ? jobsById.get(d.jobId) ?? null : null
      list.push(deviceNode(d, job, { isNew: !hasWarped(d.id) }))
    }
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Seed managed nodes synchronously so the initial frame has content.
  const [nodes, setNodes, onNodesChange] = useNodesState(useMemo(() => buildAll(), [buildAll]))
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  // ── Force simulation — owns every node position between user drags ────────
  const [sim] = useState(() => new FleetForceSim(orchestratorPos()))
  const draggingIdRef = useRef<string | null>(null)
  const settleSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reducedOs = useReducedMotion() ?? false
  const motionPref = useSettings((s) => s.motion)
  const reduceMotionPref = useSettings((s) => s.reduceMotion)
  const breathe = !reducedOs && !motionDisabled({ motion: motionPref, reduceMotion: reduceMotionPref })

  // Keep the sim's population in step with the fleet (new phones spawn at
  // their phyllotaxis/saved seed — existing ones are never re-seeded).
  useEffect(() => {
    sim.sync(snapshot.devices.map((d) => ({ id: d.id, ...positionFor(d.id) })))
  }, [snapshot.devices, sim])

  // The living loop: integrate physics, then write positions into React Flow.
  // Node `data` identities are preserved so memoized cards skip re-rendering.
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      sim.tick((now - last) / 1000, now / 1000, breathe)
      last = now
      setNodes((ns) => {
        let changed = false
        const next = ns.map((n) => {
          if (n.id === draggingIdRef.current) return n
          const s = sim.get(n.id)
          if (!s) return n
          const half = n.type === 'orchestrator' ? CORE_SIZE / 2 : undefined
          const x = s.x - (half ?? NODE_W / 2)
          const y = s.y - (half ?? NODE_H / 2)
          if (Math.abs(n.position.x - x) < 0.04 && Math.abs(n.position.y - y) < 0.04) return n
          changed = true
          return { ...n, position: { x, y } }
        })
        return changed ? next : ns
      })
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [breathe, setNodes, sim])

  // Sync the live snapshot + filters + selection into managed nodes: update
  // data in place, warp in new devices, dissolve removed.
  useEffect(() => {
    const currentIds = new Set(snapshot.devices.map((d) => d.id))
    const anySelected = selectedIds.length > 0
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]))
      const next: Node[] = [byId.get('orchestrator') ?? makeOrchestrator()]

      for (const d of snapshot.devices) {
        const job = d.jobId ? jobsById.get(d.jobId) ?? null : null
        const isMatch = matches(d)
        const dimmed = filtersOn && !isMatch
        const emphasized = filtersOn && isMatch
        // Selection focus: unrelated phones drop to 20% while one is selected.
        const selDimmed = anySelected && !selectedIds.includes(d.id)
        const gc = filters.groups.length > 1 ? groupColor(filters.groups, d.group) : null
        const hidden = filters.hideNonMatching && dimmed
        const existing = byId.get(d.id)
        if (existing) {
          next.push({
            ...existing,
            hidden,
            // Matching phones stack above dimmed ones; selection above all.
            zIndex: existing.selected ? 30 : emphasized ? 20 : (existing.data as DeviceNodeData).hovered ? 25 : 0,
            data: { ...existing.data, device: d, job, exiting: false, dimmed, emphasized, selDimmed, groupColor: gc },
          })
        } else {
          next.push({ ...deviceNode(d, job, { isNew: !hasWarped(d.id), dimmed, emphasized, selDimmed, groupColor: gc }), hidden })
        }
      }

      for (const n of prev) {
        if (n.id === 'orchestrator' || currentIds.has(n.id)) continue
        const alreadyExiting = (n.data as DeviceNodeData).exiting
        if (alreadyExiting) {
          next.push(n)
        } else {
          setTimeout(() => setNodes((ns) => ns.filter((x) => x.id !== n.id)), DISSOLVE_MS)
          next.push({ ...n, selected: false, zIndex: 0, data: { ...n.data, exiting: true } })
        }
      }
      return next
    })
  }, [snapshot.devices, jobsById, setNodes, matches, filtersOn, filters.groups, filters.hideNonMatching, selectedIds])

  const edges = useMemo<Edge[]>(
    () =>
      snapshot.devices
        .filter((d) => d.status !== 'offline')
        .filter((d) => !(filters.hideNonMatching && filtersOn && !matches(d)))
        .map((d) => {
          const isMatch = matches(d)
          const isSelected = selectedIds.includes(d.id)
          return {
            id: `e-${d.id}`,
            source: 'orchestrator',
            target: d.id,
            sourceHandle: 'core',
            targetHandle: 'in',
            type: 'pulse',
            data: {
              active: d.status === 'busy',
              emphasized: filtersOn && isMatch,
              // Selected node's connection goes to full strength; others fade
              // while a selection exists.
              selected: isSelected,
              dimmed: (filtersOn && !isMatch) || (selectedIds.length > 0 && !isSelected),
            },
          }
        }),
    [snapshot.devices, filtersOn, filters.hideNonMatching, matches, selectedIds],
  )

  // --- interaction ---------------------------------------------------------

  const onNodeMouseEnter = useCallback(
    (_: unknown, node: Node) => {
      if (node.type !== 'device') return
      setNodes((ns) =>
        ns.map((n) => {
          if (n.id === node.id) return { ...n, zIndex: 25, data: { ...n.data, hovered: true } }
          if ((n.data as DeviceNodeData)?.hovered)
            return { ...n, zIndex: n.selected ? 30 : 0, data: { ...n.data, hovered: false } }
          return n
        }),
      )
    },
    [setNodes],
  )

  const onNodeMouseLeave = useCallback(
    (_: unknown, node: Node) => {
      setNodes((ns) =>
        ns.map((n) =>
          n.id === node.id
            ? { ...n, zIndex: n.selected ? 30 : 0, data: { ...n.data, hovered: false } }
            : n,
        ),
      )
    },
    [setNodes],
  )

  const onSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    setSelectedIds(params.nodes.filter((n) => n.type === 'device').map((n) => n.id))
  }, [])

  // Single click → select + compact info card (rendered by the node itself).
  // Double-click → the shared device sidebar. Drags never reach either
  // (6px threshold); React Flow handles selection natively on click.
  const openDrawer = useUIStore((s) => s.openDrawer)
  const closeDrawer = useUIStore((s) => s.closeDrawer)
  const onNodeDoubleClick = useCallback(
    (_: unknown, node: Node) => {
      if (node.type === 'device') openDrawer(node.id)
    },
    [openDrawer],
  )

  const clearSelection = useCallback(() => {
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)))
    // Empty-canvas click also closes the sidebar — unless the operator pinned it.
    if (!useUIStore.getState().drawerPinned) closeDrawer()
  }, [setNodes, closeDrawer])

  // Escape clears selection / closes the sidebar (the drawer handles its own
  // Escape when focused; this covers graph-focused Escape).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearSelection()
      // Keyboard access: Enter opens the sidebar for a single selected phone.
      if (e.key === 'Enter' && selectedIds.length === 1) openDrawer(selectedIds[0])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clearSelection, selectedIds, openDrawer])

  // ── Drag = pin the node in the simulation ──────────────────────────────────
  // The pointer pins the grabbed node; springs stretch elastically, neighbors
  // (and the heavy core) get pulled, then everything settles with damping.
  // Dragging the core therefore tows the whole constellation physically.
  const pinFromNode = useCallback((node: Node) => {
    const half = node.type === 'orchestrator' ? CORE_SIZE / 2 : undefined
    sim.pin(node.id, node.position.x + (half ?? NODE_W / 2), node.position.y + (half ?? NODE_H / 2))
  }, [sim])

  // Core drags tow the constellation by the exact pointer delta (rigid, no
  // spring rebound); breathing/repulsion keep it feeling alive on top.
  const corePinLast = useRef<{ x: number; y: number } | null>(null)

  const onNodeDragStart = useCallback((_: unknown, node: Node) => {
    draggingIdRef.current = node.id
    pinFromNode(node)
    if (node.type === 'orchestrator') {
      corePinLast.current = { x: node.position.x, y: node.position.y }
    }
  }, [pinFromNode])

  const onNodeDrag = useCallback((_: unknown, node: Node) => {
    if (node.type === 'orchestrator' && corePinLast.current) {
      const dx = node.position.x - corePinLast.current.x
      const dy = node.position.y - corePinLast.current.y
      if (dx !== 0 || dy !== 0) {
        sim.translatePhones(dx, dy)
        corePinLast.current = { x: node.position.x, y: node.position.y }
      }
    }
    pinFromNode(node)
  }, [pinFromNode, sim])

  // Release → the dropped spot becomes the node's new equilibrium; one batched
  // save runs after the field settles (never per pointer-move frame).
  const onNodeDragStop = useCallback((_: unknown, node: Node) => {
    draggingIdRef.current = null
    corePinLast.current = null
    sim.unpin(node.id)
    if (settleSaveRef.current) clearTimeout(settleSaveRef.current)
    settleSaveRef.current = setTimeout(() => {
      saveOrchestratorPos({ x: sim.core.x, y: sim.core.y })
      for (const n of sim.all()) savePosition(n.id, { x: n.x, y: n.y })
    }, 1500)
  }, [sim])

  const onMoveEnd = useCallback((_: unknown, viewport: Viewport) => {
    saveViewport(viewport)
  }, [])

  const bulk = useMemo(
    () => ({
      start: () => selectedIds.forEach((id) => void client.start(id)),
      stop: () => selectedIds.forEach((id) => void client.stop(id)),
      assign: () =>
        selectedIds.forEach((id) => void client.runTask(id, { type: 'upload', label: 'Bulk upload' })),
      retire: () => {
        selectedIds.forEach((id) => void client.delete(id))
        clearSelection()
      },
    }),
    [selectedIds, clearSelection],
  )

  const initialViewport = useMemo(() => savedViewport(), [])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onNodeMouseEnter={onNodeMouseEnter}
      onNodeMouseLeave={onNodeMouseLeave}
      onSelectionChange={onSelectionChange}
      onNodeDoubleClick={onNodeDoubleClick}
      onPaneClick={clearSelection}
      onNodeDragStart={onNodeDragStart}
      onNodeDrag={onNodeDrag}
      onNodeDragStop={onNodeDragStop}
      onMoveEnd={onMoveEnd}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      {...(initialViewport
        ? { defaultViewport: initialViewport }
        : { fitView: true, fitViewOptions: { padding: 0.28 } })}
      minZoom={0.2}
      maxZoom={2}
      nodesDraggable={!locked}
      nodeDragThreshold={6}
      nodesConnectable={false}
      elementsSelectable
      selectNodesOnDrag={false}
      zoomOnDoubleClick={false}
      panOnDrag
      panOnScroll={false}
      proOptions={{ hideAttribution: true }}
      className="fleet-flow bg-canvas"
    >
      <Background variant={BackgroundVariant.Dots} gap={30} size={1} color="#1b2230" />
      <GraphControls />
      <AnimatePresence>
        {selectedIds.length > 1 && (
          <BulkActionBar
            count={selectedIds.length}
            onStart={bulk.start}
            onStop={bulk.stop}
            onAssign={bulk.assign}
            onRetire={bulk.retire}
            onClear={clearSelection}
          />
        )}
      </AnimatePresence>
    </ReactFlow>
  )
}

export function FleetGraph({ filters, locked }: { filters: FleetFilters; locked: boolean }) {
  return (
    <div className="h-full w-full">
      <ReactFlowProvider>
        <Graph filters={filters} locked={locked} />
      </ReactFlowProvider>
    </div>
  )
}
