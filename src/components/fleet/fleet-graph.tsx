import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { client } from '@/lib/provider'
import { graphBus } from '@/lib/graph-bus'
import { useUIStore, fleetFiltersActive, type FleetFilters } from '@/state/ui-store'
import {
  hasWarped, positionFor, savePosition,
  orchestratorPos, saveOrchestratorPos,
  savedViewport, saveViewport,
} from '@/lib/layout/constellation'
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

  // Sync the live snapshot + filters into managed nodes: update data in place
  // (keeps selection / drag positions), warp in new devices, dissolve removed.
  useEffect(() => {
    const currentIds = new Set(snapshot.devices.map((d) => d.id))
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]))
      const next: Node[] = [byId.get('orchestrator') ?? makeOrchestrator()]

      for (const d of snapshot.devices) {
        const job = d.jobId ? jobsById.get(d.jobId) ?? null : null
        const isMatch = matches(d)
        const dimmed = filtersOn && !isMatch
        const emphasized = filtersOn && isMatch
        const gc = filters.groups.length > 1 ? groupColor(filters.groups, d.group) : null
        const hidden = filters.hideNonMatching && dimmed
        const existing = byId.get(d.id)
        if (existing) {
          next.push({
            ...existing,
            hidden,
            // Matching phones stack above dimmed ones; selection above all.
            zIndex: existing.selected ? 30 : emphasized ? 20 : (existing.data as DeviceNodeData).hovered ? 25 : 0,
            data: { ...existing.data, device: d, job, exiting: false, dimmed, emphasized, groupColor: gc },
          })
        } else {
          next.push({ ...deviceNode(d, job, { isNew: !hasWarped(d.id), dimmed, emphasized, groupColor: gc }), hidden })
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
  }, [snapshot.devices, jobsById, setNodes, matches, filtersOn, filters.groups, filters.hideNonMatching])

  const edges = useMemo<Edge[]>(
    () =>
      snapshot.devices
        .filter((d) => d.status !== 'offline')
        .filter((d) => !(filters.hideNonMatching && filtersOn && !matches(d)))
        .map((d) => {
          const isMatch = matches(d)
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
              dimmed: filtersOn && !isMatch,
            },
          }
        }),
    [snapshot.devices, filtersOn, filters.hideNonMatching, matches],
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

  // Double-click → full phone control page (single click only selects).
  const openPhoneControl = useUIStore((s) => s.openPhoneControl)
  const onNodeDoubleClick = useCallback(
    (_: unknown, node: Node) => {
      if (node.type === 'device') openPhoneControl(node.id)
    },
    [openPhoneControl],
  )

  const clearSelection = useCallback(
    () => setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n))),
    [setNodes],
  )

  // Escape clears selection / closes the contextual card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearSelection()
      // Keyboard access: Enter opens control for a single selected phone.
      if (e.key === 'Enter' && selectedIds.length === 1) openPhoneControl(selectedIds[0])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clearSelection, selectedIds, openPhoneControl])

  // Operator drag → persist the node's center in graph coordinates.
  const onNodeDragStop = useCallback((_: unknown, node: Node) => {
    if (node.type === 'orchestrator') {
      saveOrchestratorPos({ x: node.position.x + CORE_SIZE / 2, y: node.position.y + CORE_SIZE / 2 })
      return
    }
    savePosition(node.id, { x: node.position.x + NODE_W / 2, y: node.position.y + NODE_H / 2 })
  }, [])

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
