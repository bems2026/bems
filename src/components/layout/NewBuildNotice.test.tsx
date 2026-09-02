import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { NewBuildNotice } from './NewBuildNotice';
import { BUILD_CHECK_MS, KIOSK_IDLE_MS, IDLE_RECHECK_MS } from '@/hooks/useBuildWatch';

/**
 * RM-043. The failure this defends against is silent by construction: the office kiosk ran a
 * week-old build through four deploys and nothing on any screen said so.
 *
 * The property that matters MOST here is the negative one — a reload must be EARNED. A wrong
 * reload puts the office display into a loop, which is far worse than a slightly old build.
 */

const BOOTED = '/assets/index-AAAA.js';
const page = (src: string) => `<!doctype html><html><head><script type="module" crossorigin src="${src}"></script></head><body></body></html>`;

let reload: ReturnType<typeof vi.fn>;

function serve(body: string, ok = true) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, text: async () => body }));
}

beforeEach(() => {
  vi.useFakeTimers();
  // The document this "tab" booted from.
  document.head.innerHTML = `<script type="module" src="${BOOTED}"></script>`;
  reload = vi.fn();
  vi.stubGlobal('location', { hostname: '127.0.0.1', pathname: '/', reload });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.head.innerHTML = '';
});

/** One poll interval, with the promise chain inside it allowed to settle. */
async function tick() {
  // Inside `act`, because the state update happens in the fetch callback rather than in an
  // event handler — without it the timers advance, the hook runs, and the DOM never catches up.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(BUILD_CHECK_MS + 10);
  });
}

/**
 * A poll that happens one second after somebody touched the screen.
 *
 * Firing the interaction and THEN advancing a full interval does not simulate a person using
 * the display — it simulates one who left five minutes ago, which is exactly what the idle rule
 * is meant to treat as absent. A first version of these tests did that and reported the guard
 * as broken when it was working.
 */
async function tickWhileTouched() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(BUILD_CHECK_MS - 1000);
  });
  fireEvent.pointerDown(window);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1010);
  });
}

describe('NewBuildNotice', () => {
  it('says nothing while the served build is the one running', async () => {
    serve(page(BOOTED));
    render(<NewBuildNotice />);
    await tick();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads the kiosk itself, because nobody is standing at it to click anything', async () => {
    serve(page('/assets/index-BBBB.js'));
    render(<NewBuildNotice />);
    await tick();
    expect(reload).toHaveBeenCalled();
  });

  it('does not reload the kiosk while somebody is touching it', async () => {
    // Somebody IS occasionally standing at the office display. A reload under their finger is
    // the same discourtesy this avoids for remote viewers.
    serve(page('/assets/index-BBBB.js'));
    render(<NewBuildNotice />);
    await tickWhileTouched();
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('reloads once the kiosk has been left alone again', async () => {
    serve(page('/assets/index-BBBB.js'));
    render(<NewBuildNotice />);
    await tickWhileTouched();
    expect(reload).not.toHaveBeenCalled();
    // Not another full poll: once the new build is known the hook re-checks only for idleness,
    // on a much shorter timer. Waiting BUILD_CHECK_MS here would have hidden that.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(KIOSK_IDLE_MS + IDLE_RECHECK_MS);
    });
    expect(reload).toHaveBeenCalled();
  });

  it('offers a remote viewer the choice instead of taking it', async () => {
    // They may be mid-command.
    vi.stubGlobal('location', { hostname: 'bems.example.ts.net', pathname: '/', reload });
    serve(page('/assets/index-BBBB.js'));
    render(<NewBuildNotice />);
    await tick();
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalled();
  });

  it('stays dismissed for the rest of the tab, rather than asking again every five minutes', async () => {
    vi.stubGlobal('location', { hostname: 'bems.example.ts.net', pathname: '/', reload });
    serve(page('/assets/index-BBBB.js'));
    render(<NewBuildNotice />);
    await tick();
    fireEvent.click(screen.getByRole('button', { name: /Dismiss/ }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await tick();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('treats a failed check as no news, never as a new build', async () => {
    // THE ONE THAT KEEPS THE OFFICE DISPLAY OUT OF A RELOAD LOOP. This dashboard is looked at
    // precisely when the network is unhappy.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<NewBuildNotice />);
    await tick();
    expect(reload).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('treats an error page as no news, even though it is not the running bundle', async () => {
    // A proxy error page differs from the running bundle in every way, and reloading into it
    // would be a loop against a page that never contains a bundle at all.
    serve('<html><body>502 Bad Gateway</body></html>');
    render(<NewBuildNotice />);
    await tick();
    expect(reload).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does nothing at all in a document with no module script', async () => {
    document.head.innerHTML = '';
    serve(page('/assets/index-BBBB.js'));
    render(<NewBuildNotice />);
    await tick();
    expect(reload).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('asks the server, not the browser cache — a cached answer always agrees with itself', async () => {
    serve(page(BOOTED));
    render(<NewBuildNotice />);
    await tick();
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init as RequestInit).cache).toBe('no-store');
  });
});
