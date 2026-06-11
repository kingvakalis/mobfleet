import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { OrchestratorMark } from '@/components/layout/orchestrator-mark'

export const CORE_SIZE = 128

const centeredHandle =
  '!h-1.5 !w-1.5 !min-w-0 !min-h-0 !rounded-full !border-0 !bg-transparent !opacity-0'

/** The central core every active node wires back to. */
export const OrchestratorNode = memo(function OrchestratorNode() {
  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: CORE_SIZE, height: CORE_SIZE }}
    >
      <Handle
        id="core"
        type="source"
        position={Position.Top}
        className={centeredHandle}
        style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
      />

      {/* soft accent pulse — the one place accent is used in the graph */}
      <div
        className="absolute inset-0 rounded-full animate-ring-pulse"
        style={{ boxShadow: '0 0 0 1px var(--accent)' }}
      />
      <div className="absolute inset-2 rounded-full border border-line bg-panel" />

      <div className="relative flex flex-col items-center gap-1.5">
        <OrchestratorMark size={30} />
        <span className="label text-[8px] text-fg-secondary">ORCHESTRATOR</span>
      </div>
    </div>
  )
})
