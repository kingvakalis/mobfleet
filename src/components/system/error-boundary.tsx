import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

/** App-level fault barrier with a designed HUD fallback. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI fault:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-full min-h-screen items-center justify-center bg-canvas p-8">
        <div className="relative w-[420px] max-w-full rounded-card border border-line bg-panel p-7">
          <div className="label" style={{ color: 'var(--status-error)' }}>
            System Fault
          </div>
          <p className="mt-4 text-sm text-fg-secondary">
            The control plane hit an unexpected error and stopped rendering.
          </p>
          <pre className="mono mt-4 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-control border border-line bg-canvas p-3 text-[11px] text-fg-muted">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => location.reload()}
            className="mt-5 inline-flex h-9 items-center rounded-control bg-fg px-4 text-sm font-medium text-canvas transition-colors hover:bg-white/90"
          >
            Reload control plane
          </button>
        </div>
      </div>
    )
  }
}
