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
import { AnimatePresence } from 'framer-motion'
import '@xyflow/react/dist/style.css'
import { useFleet } from '@/hooks/use-fleet'
import { useScopedDevices } from '@/lib/authorization/use-access'
import { client, safe } from '@/lib/provider'
import { graphBus } from '@/lib/graph-bus'
import { useUIStore, fleetFiltersActive, type FleetFilters } from '@/state/ui-store'
import {
  hasWarped, positionFor, savePosition,
  orchestratorPos, saveOrchestratorPos,
  savedViewport, saveViewport,
  pinnedIds, setPinnedId, clearPinned,
} from '@/lib/layout/constellation'
import { FleetForceSim } from '@/lib/layout/force-sim'
import { matchesDevice, groupColor } from '@/lib/fleet-filtering'
import type { Device, Job } from '@/lib/provider/types'
import { DeviceNode, NODE_H, NODE_W, type DeviceNodeData } from './device-node'
import { CORE_SIZE, OrchestratorNode } from './orchestrator-node'
import { PulseEdge } from './pulse-edge'
import { GraphControls } from './graph-controls'
import { BulkActionBar } from './bulk-action-bar'
import { PhysicsDebugLayer } from './physics-debug-layer'

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
  // SECURITY: render only devices within the acting member's scope — the graph
  // must not surface phones outside their assignment.
  const scopedDevices = useScopedDevices()
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
    () => scopedDevices.filter(matches).map((d) => d.id),
    [scopedDevices, matches],
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
    for (const d of scopedDevices) {
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
  // Loop lifecycle: the sim ticks only while there's energy in the field, then
  // stops (no idle drift, no wasted renders). `reheat` restarts it.
  const runningRef = useRef(false)
  const rafRef = useRef(0)
  const lastRef = useRef(0)
  // Set when the operator changes the layout (drag/pin), so we persist the
  // settled formation — but never persist on the initial post-load settle.
  const dirtyRef = useRef(false)
  // Dev-only physics debug overlay (toggle with "g" while the graph is focused).
  const [debug, setDebug] = useState(false)

  // Persist the SETTLED formation (orbit positions, core, pins) — never a
  // transient far-drag position, since by settle the phone has flowed back.
  const saveLayout = useCallback(() => {
    saveOrchestratorPos({ x: sim.core.x, y: sim.core.y })
    for (const n of sim.all()) savePosition(n.id, { x: n.x, y: n.y })
  }, [sim])

  // The living loop: integrate physics → write positions into React Flow. Runs
  // only while the field has energy; stops itself once settled (and saves if the
  // operator changed anything), so there is zero idle cost or drift.
  const startLoop = useCallback(() => {
    if (runningRef.current) return
    runningRef.current = true
    lastRef.current = performance.now()
    const frame = (now: number) => {
      if (!runningRef.current) return
      sim.tick((now - lastRef.current) / 1000)
      lastRef.current = now
      setNodes((ns) => {
        let changed = false
        const next = ns.map((n) => {
          if (n.id === draggingIdRef.current) return n // pointer owns this one
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
      if (sim.isSettled()) {
        runningRef.current = false
        if (dirtyRef.current) { dirtyRef.current = false; saveLayout() }
        return
      }
      rafRef.current = requestAnimationFrame(frame)
    }
    rafRef.current = requestAnimationFrame(frame)
  }, [sim, setNodes, saveLayout])

  // Re-energise the field and make sure the loop is running.
  const reheat = useCallback(() => {
    sim.reheat()
    startLoop()
  }, [sim, startLoop])

  // Keep the sim's population in step with the fleet (new phones spawn at their
  // phyllotaxis/saved seed). A membership change re-energises the field so the
  // constellation reflows; filters never touch the sim (hidden phones stay in
  // the simulation to preserve the layout — see render/edges).
  // Pin state version bumps re-sync node data badges.
  const [pinEpoch, setPinEpoch] = useState(0)
  useEffect(() => {
    const pins = new Set(pinnedIds())
    const changed = sim.sync(scopedDevices.map((d) => ({ id: d.id, ...positionFor(d.id), pinned: pins.has(d.id) })))
    if (changed) reheat()
  }, [scopedDevices, sim, reheat])

  // Pin controls for the info card + filter bar.
  useEffect(() => {
    graphBus.togglePin = (id: string) => {
      const next = !sim.isPinned(id)
      sim.setPinned(id, next)
      setPinnedId(id, next)
      const n = sim.get(id)
      if (n) savePosition(id, { x: n.x, y: n.y })
      setPinEpoch((e) => e + 1)
      dirtyRef.current = true
      reheat()
    }
    graphBus.isPinned = (id: string) => sim.isPinned(id)
    graphBus.unpinAll = () => {
      sim.unpinAll()
      clearPinned()
      setPinEpoch((e) => e + 1)
      dirtyRef.current = true
      reheat()
    }
    return () => {
      graphBus.togglePin = undefined
      graphBus.isPinned = undefined
      graphBus.unpinAll = undefined
    }
  }, [sim, reheat])

  // Start the loop on mount; pause it when the tab is hidden (no off-screen
  // ticking), resume on return. The loop self-stops once settled.
  useEffect(() => {
    startLoop()
    const onVis = () => {
      if (document.hidden) {
        runningRef.current = false
        cancelAnimationFrame(rafRef.current)
      } else {
        reheat()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      runningRef.current = false
      cancelAnimationFrame(rafRef.current)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [startLoop, reheat])

  // Dev-only: toggle the physics debug overlay.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'g' || e.key === 'G') && !e.metaKey && !e.ctrlKey) setDebug((d) => !d)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Sync the live snapshot + filters + selection into managed nodes: update
  // data in place, warp in new devices, dissolve removed.
  useEffect(() => {
    const currentIds = new Set(scopedDevices.map((d) => d.id))
    const anySelected = selectedIds.length > 0
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]))
      const next: Node[] = [byId.get('orchestrator') ?? makeOrchestrator()]

      for (const d of scopedDevices) {
        const job = d.jobId ? jobsById.get(d.jobId) ?? null : null
        const isMatch = matches(d)
        const dimmed = filtersOn && !isMatch
        const emphasized = filtersOn && isMatch
        // Selection focus: unrelated phones drop to 20% while one is selected.
        const selDimmed = anySelected && !selectedIds.includes(d.id)
        const gc = filters.groups.length > 1 ? groupColor(filters.groups, d.group) : null
        const hidden = filters.hideNonMatching && dimmed
        const pinned = sim.isPinned(d.id)
        const existing = byId.get(d.id)
        if (existing) {
          next.push({
            ...existing,
            hidden,
            // Matching phones stack above dimmed ones; selection above all.
            zIndex: existing.selected ? 30 : emphasized ? 20 : (existing.data as DeviceNodeData).hovered ? 25 : 0,
            data: { ...existing.data, device: d, job, exiting: false, dimmed, emphasized, selDimmed, groupColor: gc, pinned },
          })
        } else {
          next.push({ ...deviceNode(d, job, { isNew: !hasWarped(d.id), dimmed, emphasized, selDimmed, groupColor: gc, pinned }), hidden })
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
  }, [scopedDevices, jobsById, setNodes, matches, filtersOn, filters.groups, filters.hideNonMatching, selectedIds, sim, pinEpoch])

  const edges = useMemo<Edge[]>(
    () =>
      scopedDevices
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
    [scopedDevices, filtersOn, filters.hideNonMatching, matches, selectedIds],
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

  // ── Drag = a TEMPORARY pointer anchor (never a pin) ────────────────────────
  // The pointer holds only the grabbed node each frame; everything else reacts
  // through the force field:
  //   • core drag  → springs re-aim, phones flow to surround the new centre;
  //   • phone drag → its spring stretches, pulling the (free, heavy) core a
  //                  little, which re-aims every other phone (back-reaction).
  // On release the node rejoins the field — a phone flows back to its orbit; it
  // is NOT pinned. Selection and the sidebar never touch any of this. Only the
  // explicit Pin action (graphBus.togglePin) freezes a phone.
  const centerOf = useCallback((node: Node) => {
    const half = node.type === 'orchestrator' ? CORE_SIZE / 2 : undefined
    return { x: node.position.x + (half ?? NODE_W / 2), y: node.position.y + (half ?? NODE_H / 2) }
  }, [])

  const onNodeDragStart = useCallback((_: unknown, node: Node) => {
    draggingIdRef.current = node.id
    const c = centerOf(node)
    sim.beginDrag(node.id, c.x, c.y)
    dirtyRef.current = true
    reheat()
  }, [sim, centerOf, reheat])

  const onNodeDrag = useCallback((_: unknown, node: Node) => {
    const c = centerOf(node)
    sim.drag(node.id, c.x, c.y)
  }, [sim, centerOf])

  // Release: clear the temporary anchor. The core records its drop spot as its
  // new home (it stays there); a phone returns to the field and settles back
  // into its orbit. No fx/fy is left set, so nothing is silently pinned.
  const onNodeDragStop = useCallback((_: unknown, node: Node) => {
    draggingIdRef.current = null
    sim.endDrag(node.id)
    dirtyRef.current = true
    reheat()
  }, [sim, reheat])

  const onMoveEnd = useCallback((_: unknown, viewport: Viewport) => {
    saveViewport(viewport)
  }, [])

  const bulk = useMemo(
    () => ({
      start: () => selectedIds.forEach((id) => safe(client.start(id), 'Could not start device')),
      stop: () => selectedIds.forEach((id) => safe(client.stop(id), 'Could not stop device')),
      assign: () =>
        selectedIds.forEach((id) => safe(client.runTask(id, { type: 'upload', label: 'Bulk upload' }), 'Could not assign task')),
      retire: () => {
        selectedIds.forEach((id) => safe(client.delete(id), 'Could not retire device'))
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
      {import.meta.env.DEV && debug && <PhysicsDebugLayer sim={sim} />}
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
