import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

/** React logs a caught error to console.error regardless of the boundary; silence it so a
 * deliberately-thrown test error doesn't read as a failing suite. */
function silenceReactErrorLog() {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}

function Boom({ throws }: { throws: boolean }): React.ReactElement {
  if (throws) throw new Error('kaboom in a card');
  return <p>page content</p>;
}

// `globals: false` in vite.config.ts means Testing Library's auto-cleanup never registers,
// so each render has to be torn down explicitly — same convention as AppShell.test.tsx.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('renders its children untouched when nothing throws', () => {
    render(
      <ErrorBoundary scope="This page">
        <Boom throws={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText('page content')).toBeInTheDocument();
  });

  it('catches a render-time throw instead of unmounting the tree', () => {
    // Without a boundary React unmounts everything, which on the office kiosk means a blank
    // white screen with no way back and nobody on site to press anything.
    silenceReactErrorLog();
    render(
      <ErrorBoundary scope="This page">
        <Boom throws />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/This page stopped responding/)).toBeInTheDocument();
  });

  it('names the scope it was given, so a page fault reads differently from a shell fault', () => {
    silenceReactErrorLog();
    render(
      <ErrorBoundary scope="The dashboard">
        <Boom throws />
      </ErrorBoundary>
    );
    expect(screen.getByText(/The dashboard stopped responding/)).toBeInTheDocument();
  });

  it('says the data services are unaffected — a display fault is not an outage', () => {
    // Ingestion, scheduling and the audit trail are separate systemd units and keep running.
    // Someone reading this on the wall should not think the building stopped being metered.
    silenceReactErrorLog();
    render(
      <ErrorBoundary scope="This page">
        <Boom throws />
      </ErrorBoundary>
    );
    expect(screen.getByText(/display fault only/i)).toBeInTheDocument();
  });

  it('shows the error message, so the fault is diagnosable from the screen itself', () => {
    silenceReactErrorLog();
    render(
      <ErrorBoundary scope="This page">
        <Boom throws />
      </ErrorBoundary>
    );
    expect(screen.getByText('kaboom in a card')).toBeInTheDocument();
  });

  it('offers a retry that re-renders the same tree', () => {
    silenceReactErrorLog();
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error('transient');
      return <p>recovered</p>;
    }
    render(
      <ErrorBoundary scope="This page">
        <Flaky />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(screen.getByText('recovered')).toBeInTheDocument();
  });

  it('offers a reload as the fallback when retrying is not enough', () => {
    silenceReactErrorLog();
    render(
      <ErrorBoundary scope="This page">
        <Boom throws />
      </ErrorBoundary>
    );
    expect(screen.getByRole('button', { name: /reload the dashboard/i })).toBeInTheDocument();
  });

  it('logs the crash with its scope, since the kiosk console is the only sink there is', () => {
    const spy = silenceReactErrorLog();
    render(
      <ErrorBoundary scope="This page">
        <Boom throws />
      </ErrorBoundary>
    );
    expect(spy.mock.calls.some((c) => String(c[0]).includes('[ibems] This page crashed:'))).toBe(true);
  });
});
