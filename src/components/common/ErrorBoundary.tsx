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
 * THE INLINE VARIANT takes that one step further — RM-076. Analytics draws a dozen charts from
 * field telemetry, and one malformed reading in one device's series used to take the whole page
 * down with it. `variant="inline"` wraps a single card: its fallback is card-sized, it does not
 * offer to reload the kiosk (the page around it is fine), and `resetKey` lets it redraw on its
 * own when the data it draws changes — the next poll usually replaces the reading that broke it,
 * and on an unattended wall display nobody is there to press "Try again".
 *
 * A class component because this is the one thing React still has no hook for.
 */
interface Props {
  children: ReactNode;
  /** What broke, in the operator's words — "This page", "The dashboard", "This chart". */
  scope: string;
  variant?: 'page' | 'inline';
  /** When this changes while the fallback is showing, the children are tried again. */
  resetKey?: unknown;
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

  componentDidUpdate(prevProps: Props) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  /** Try the same tree again — enough for a transient fault (one bad WS frame, a null that
   * should not have been), and honest about not being enough for a real bug. */
  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.variant === 'inline') {
      return (
        <div className="error-boundary error-boundary--inline" role="alert">
          <p className="error-boundary-title">{this.props.scope} could not be drawn</p>
          <p className="error-boundary-body">
            Something in the data it was given could not be rendered. The rest of this page, live data collection and stored history are unaffected, and it redraws by
            itself when new data arrives.
          </p>
          <pre className="error-boundary-detail">{error.message}</pre>
          <div className="error-boundary-actions">
            <button type="button" className="error-boundary-btn" onClick={this.retry}>
              Try again
            </button>
          </div>
        </div>
      );
    }

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
