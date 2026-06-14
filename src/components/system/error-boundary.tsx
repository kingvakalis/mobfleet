import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /**
   * When any value in this array changes while the boundary is showing its
   * fallback, the boundary resets and re-renders its children. Pass the active
   * view id here so navigating away from a broken view recovers automatically —
   * without it, a fault in one view forces a full page reload of the whole app.
   */
  resetKeys?: unknown[]
  /** Scope label shown in the fault card (e.g. the view name). */
  label?: string
}
interface State {
  error: Error | null
}

/** Fault barrier with a designed HUD fallback. Used app-wide and per-view. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI fault:', error, info)
  }

  componentDidUpdate(prev: Props) {
    // Clear the fault when a reset key changes (e.g. the operator navigates to a
    // different view), so a localized crash doesn't persist across navigation.
    if (this.state.error && this.resetKeysChanged(prev.resetKeys, this.props.resetKeys)) {
      this.setState({ error: null })
    }
  }

  private resetKeysChanged(a: unknown[] = [], b: unknown[] = []) {
    return a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]))
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-full min-h-full items-center justify-center bg-canvas p-8">
        <div className="relative w-[420px] max-w-full rounded-card border border-line bg-panel p-7">
          <div className="label" style={{ color: 'var(--status-error)' }}>
            {this.props.label ? `${this.props.label} Fault` : 'System Fault'}
          </div>
          <p className="mt-4 text-sm text-fg-secondary">
            {this.props.label
              ? 'This view hit an unexpected error. You can retry it or switch to another view.'
              : 'The control plane hit an unexpected error and stopped rendering.'}
          </p>
          <pre className="mono mt-4 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-control border border-line bg-canvas p-3 text-[11px] text-fg-muted">
            {this.state.error.message}
          </pre>
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="inline-flex h-9 items-center rounded-control bg-fg px-4 text-sm font-medium text-canvas transition-colors hover:bg-white/90"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => location.reload()}
              className="inline-flex h-9 items-center rounded-control border border-line px-4 text-sm font-medium text-fg-secondary transition-colors hover:bg-elevated"
            >
              Reload control plane
            </button>
          </div>
        </div>
      </div>
    )
  }
}
