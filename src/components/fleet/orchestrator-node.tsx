import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { OrchestratorMark } from '@/components/layout/orchestrator-mark'

export const CORE_SIZE = 128

const centeredHandle =
  '!h-1.5 !w-1.5 !min-w-0 !min-h-0 !rounded-full !border-0 !bg-transparent !opacity-0'

/** The central core every active node wires back to. */
export const OrchestratorNode = memo(function OrchestratorNode({ dragging }: NodeProps) {
  return (
    <div
      className="relative flex items-center justify-center"
      style={{
        width: CORE_SIZE,
        height: CORE_SIZE,
        cursor: dragging ? 'grabbing' : 'grab',
        filter: dragging ? 'drop-shadow(0 14px 26px rgba(0,0,0,0.6))' : undefined,
        transform: dragging ? 'scale(1.04)' : undefined,
        transition: 'transform 160ms ease',
      }}
    >
      <Handle
        id="core"
        type="source"
        position={Position.Top}
        className={centeredHandle}
        style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
      />

      {/* radial core glow */}
      <div
        className="pointer-events-none absolute -inset-8 rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(79,195,247,0.10), transparent 65%)' }}
      />

      {/* rotating segmented HUD rings */}
      <svg className="absolute inset-0 spin-slow" viewBox="0 0 128 128" fill="none" aria-hidden>
        <circle cx="64" cy="64" r="61" stroke="rgba(79,195,247,0.30)" strokeWidth="1" strokeDasharray="12 16" />
      </svg>
      <svg className="absolute inset-[9px] spin-slow-rev" viewBox="0 0 110 110" fill="none" aria-hidden>
        <circle cx="55" cy="55" r="52" stroke="rgba(255,255,255,0.16)" strokeWidth="1" strokeDasharray="3 9" />
      </svg>

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
