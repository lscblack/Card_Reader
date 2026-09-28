import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** What to show instead of the crashed subtree; defaults to a page-sized notice with a reload button. */
  fallback?: (error: Error, reset: () => void) => ReactNode
  /** Changing this value clears the error (e.g. the route path). */
  resetKey?: unknown
}

interface State {
  error: Error | null
  resetKey: unknown
}

/**
 * Stops a render error from blanking the whole app: React unmounts everything above the nearest
 * boundary, so without one a single bad value turns the page white.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Render error:', error, info.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback(error, this.reset)
    return (
      <div role="alert" className="mx-auto my-16 w-11/12 max-w-lg rounded-xl border border-border bg-surface p-6 shadow-xs">
        <p className="text-[15px] font-semibold tracking-tight">Something went wrong on this page</p>
        <p className="mt-1 text-sm text-subtle">The rest of the dashboard still works. Reload to try again.</p>
        <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-surface-2 p-2 text-xs whitespace-pre-wrap text-subtle">{error.message || String(error)}</pre>
        <div className="mt-4 flex gap-2">
          <button className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white" onClick={() => window.location.reload()}>
            Reload
          </button>
          <button className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={this.reset}>
            Try again
          </button>
        </div>
      </div>
    )
  }
}
