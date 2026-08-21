import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * The kiosk's only recovery from a render-time exception.
 *
 * `main.tsx` rendered `<StrictMode><App/></StrictMode>` with nothing to catch a throw, so
 * any render error anywhere in the tree unmounted the whole app and left a blank white
 * screen — permanently, on a wall display in an office with nobody on site to press
 * anything. React deliberately unmounts the entire tree when no boundary catches an error,
 * on the reasoning that a half-rendered UI is worse than none; that trade is right for a
 * form, and wrong for the only readout of a building's electrical system.
 *
 * Two boundaries, not one. The inner one wraps the routed page, so a fault in Analytics
 * leaves the nav, the theme toggle and every other page reachable — the failure stays the
 * size of the thing that failed. The outer one wraps everything and only ever renders if
 * the shell itself is broken.
 *
 * A class component because this is the one thing React still has no hook for.
 */
interface Props {
  children: ReactNode;
  /** What broke, in the operator's words — "This page", "The dashboard". */
  scope: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The kiosk's console is the only place this can go — there is no error-reporting
    // service in this deployment, and inventing one is out of scope here (ROADMAP FI-005
    // tracks getting alerts out of the dashboard at all).
    console.error(`[ibems] ${this.props.scope} crashed:`, error, info.componentStack);
  }

  /** Try the same tree again — enough for a transient fault (one bad WS frame, a null that
   * should not have been), and honest about not being enough for a real bug. */
  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="error-boundary" role="alert">
        <h2 className="error-boundary-title">{this.props.scope} stopped responding</h2>
        <p className="error-boundary-body">
          Something went wrong while drawing this view. Live data collection, scheduling and
          the audit trail all run as separate services and are unaffected — this is a display
          fault only.
        </p>
        <pre className="error-boundary-detail">{error.message}</pre>
        <div className="error-boundary-actions">
          <button type="button" className="error-boundary-btn" onClick={this.retry}>
            Try again
          </button>
          <button
            type="button"
            className="error-boundary-btn error-boundary-btn--quiet"
            onClick={() => window.location.reload()}
          >
            Reload the dashboard
          </button>
        </div>
      </div>
    );
  }
}
