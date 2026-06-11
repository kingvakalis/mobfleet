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
} from '@xyflow/react'
import { AnimatePresence } from 'framer-motion'
import '@xyflow/react/dist/style.css'
import { useFleet } from '@/hooks/use-fleet'
import { client } from '@/lib/provider'
import { graphBus } from '@/lib/graph-bus'
import { useUIStore } from '@/state/ui-store'
import { hasWarped, positionFor } from '@/lib/layout/constellation'
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
  return {
    id: 'orchestrator',
    type: 'orchestrator',
    position: { x: -CORE_SIZE / 2, y: -CORE_SIZE / 2 },
    data: {},
    draggable: false,
    selectable: false,
  }
}

function deviceNode(d: Device, job: Job | null, opts: { isNew?: boolean }): Node {
  const p = positionFor(d.id)
  const data: DeviceNodeData = { device: d, job, pos: p, ...opts }
  return {
    id: d.id,
    type: 'device',
    position: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 },
    data,
    draggable: false,
  }
}

function buildAll(devices: Device[], jobsById: Map<string, Job>): Node[] {
  const list: Node[] = [makeOrchestrator()]
  for (const d of devices) {
    const job = d.jobId ? jobsById.get(d.jobId) ?? null : null
    list.push(deviceNode(d, job, { isNew: !hasWarped(d.id) }))
  }
  return list
}

function Graph() {
  const snapshot = useFleet()
  const { fitView } = useReactFlow()

  // Expose fit-to-screen to the command palette.
  useEffect(() => {
    graphBus.fitView = () => void fitView({ padding: 0.28, duration: 400 })
    return () => {
      graphBus.fitView = undefined
    }
  }, [fitView])

  const jobsById = useMemo(() => {
    const m = new Map<string, Job>()
    for (const j of snapshot.jobs) m.set(j.id, j)
    return m
  }, [snapshot.jobs])

  // Seed managed nodes synchronously so fitView has something to frame.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialNodes = useMemo(() => buildAll(snapshot.devices, jobsById), [])
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  // Sync the live snapshot into managed nodes: update data in place (keeps
  // selection / hover / zIndex), warp in new devices, hold removed ones for the
  // dissolve, then drop them.
  useEffect(() => {
    const currentIds = new Set(snapshot.devices.map((d) => d.id))
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]))
      const next: Node[] = [byId.get('orchestrator') ?? makeOrchestrator()]

      for (const d of snapshot.devices) {
        const job = d.jobId ? jobsById.get(d.jobId) ?? null : null
        const existing = byId.get(d.id)
        if (existing) {
          next.push({ ...existing, data: { ...existing.data, device: d, job, exiting: false } })
        } else {
          next.push(deviceNode(d, job, { isNew: !hasWarped(d.id) }))
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
  }, [snapshot.devices, jobsById, setNodes])

  const edges = useMemo<Edge[]>(
    () =>
      snapshot.devices
        .filter((d) => d.status !== 'offline')
        .map((d) => ({
          id: `e-${d.id}`,
          source: 'orchestrator',
          target: d.id,
          sourceHandle: 'core',
          targetHandle: 'in',
          type: 'pulse',
          data: { active: d.status === 'busy' },
        })),
    [snapshot.devices],
  )

  // --- interaction ---------------------------------------------------------

  const onNodeMouseEnter = useCallback(
    (_: unknown, node: Node) => {
      if (node.type !== 'device') return
      setNodes((ns) =>
        ns.map((n) => {
          if (n.id === node.id) return { ...n, zIndex: 1000, data: { ...n.data, hovered: true } }
          if ((n.data as DeviceNodeData)?.hovered)
            return { ...n, zIndex: n.selected ? 10 : 0, data: { ...n.data, hovered: false } }
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
            ? { ...n, zIndex: n.selected ? 10 : 0, data: { ...n.data, hovered: false } }
            : n,
        ),
      )
    },
    [setNodes],
  )

  const onSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    setSelectedIds(params.nodes.filter((n) => n.type === 'device').map((n) => n.id))
  }, [])

  const openDrawer = useUIStore((s) => s.openDrawer)
  const onNodeDoubleClick = useCallback(
    (_: unknown, node: Node) => {
      if (node.type === 'device') openDrawer(node.id)
    },
    [openDrawer],
  )

  const clearSelection = useCallback(
    () => setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n))),
    [setNodes],
  )

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
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.28 }}
      minZoom={0.2}
      maxZoom={2}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      selectNodesOnDrag={false}
      zoomOnDoubleClick={false}
      proOptions={{ hideAttribution: true }}
      className="bg-canvas"
    >
      <Background variant={BackgroundVariant.Dots} gap={30} size={1} color="#161616" />
      <GraphControls />
      <AnimatePresence>
        {selectedIds.length > 0 && (
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

export function FleetGraph() {
  return (
    <div className="h-full w-full">
      <ReactFlowProvider>
        <Graph />
      </ReactFlowProvider>
    </div>
  )
}
