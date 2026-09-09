import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useHashRoute, useHashSubRoute, navigateTo } from './useHashRoute';

/** jsdom dispatches the native `hashchange` event asynchronously (a queued task, not
 * synchronous with the assignment) — real browsers do the same, which is fine for actual
 * usage but makes `window.location.hash = …` alone non-deterministic inside a synchronous
 * `act()` block. Dispatching it manually keeps the test deterministic without depending on
 * jsdom's internal timing. */
function setHash(hash: string) {
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

const IDS = ['overview', 'analytics', 'control', 'devices', 'automation'] as const;

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('useHashRoute', () => {
  it('falls back when there is no hash', () => {
    const { result } = renderHook(() => useHashRoute(IDS, 'overview'));
    expect(result.current).toBe('overview');
  });

  it('reads a valid hash already present at mount — a deep link lands directly on that page', () => {
    window.location.hash = '#control';
    const { result } = renderHook(() => useHashRoute(IDS, 'overview'));
    expect(result.current).toBe('control');
  });

  it('falls back for an unknown hash rather than routing to a page that does not exist', () => {
    window.location.hash = '#not-a-real-page';
    const { result } = renderHook(() => useHashRoute(IDS, 'overview'));
    expect(result.current).toBe('overview');
  });

  it('updates when the hash changes after mount', () => {
    const { result } = renderHook(() => useHashRoute(IDS, 'overview'));
    expect(result.current).toBe('overview');
    act(() => {
      setHash('#devices');
    });
    expect(result.current).toBe('devices');
  });

  it('keeps the current page when the hash changes to a non-route anchor', () => {
    // AppShell's skip link is `<a href="#main-content">`, so activating it fires a
    // hashchange with a hash that names no page. Treating that as "fall back to Overview"
    // meant the skip link threw a keyboard user off whatever page they were on — the exact
    // opposite of its job.
    const { result } = renderHook(() => useHashRoute(IDS, 'overview'));
    act(() => {
      setHash('#devices');
    });
    expect(result.current).toBe('devices');

    act(() => {
      setHash('#main-content');
    });
    expect(result.current).toBe('devices');
  });

  it('navigateTo sets the hash, which the hook then picks up', () => {
    const { result } = renderHook(() => useHashRoute(IDS, 'overview'));
    act(() => {
      navigateTo('analytics');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(window.location.hash).toBe('#analytics');
    expect(result.current).toBe('analytics');
  });
});

describe('useHashRoute with a tab segment', () => {
  it('resolves the page from the first segment, so a tab deep link still lands on the page', () => {
    window.location.hash = '#automation/events';
    const { result } = renderHook(() => useHashRoute(IDS, 'overview'));
    expect(result.current).toBe('automation');
  });

  it('still leaves the page alone for a non-route anchor, now that the hash is split', () => {
    // The skip link is `#main-content`. Split on '/', its first segment is still not a page,
    // so the rule that protects it is unchanged — this is the case that would break if the
    // split were done carelessly.
    const { result } = renderHook(() => useHashRoute(IDS, 'overview'));
    act(() => {
      setHash('#automation/time');
    });
    expect(result.current).toBe('automation');
    act(() => {
      setHash('#main-content');
    });
    expect(result.current).toBe('automation');
  });

  it('navigateTo can deep-link to a tab', () => {
    act(() => {
      navigateTo('automation', 'state');
    });
    expect(window.location.hash).toBe('#automation/state');
  });
});

describe('useHashSubRoute', () => {
  const SUBS = ['overview', 'time', 'state', 'events'] as const;

  it('falls back when the hash names the page but no tab', () => {
    window.location.hash = '#automation';
    const { result } = renderHook(() => useHashSubRoute('automation', SUBS, 'overview'));
    expect(result.current[0]).toBe('overview');
  });

  it('reads a tab already present at mount', () => {
    window.location.hash = '#automation/events';
    const { result } = renderHook(() => useHashSubRoute('automation', SUBS, 'overview'));
    expect(result.current[0]).toBe('events');
  });

  it('falls back for an unknown tab rather than rendering no panel at all', () => {
    window.location.hash = '#automation/not-a-tab';
    const { result } = renderHook(() => useHashSubRoute('automation', SUBS, 'overview'));
    expect(result.current[0]).toBe('overview');
  });

  it('ignores a sub segment belonging to a different page', () => {
    window.location.hash = '#devices/time';
    const { result } = renderHook(() => useHashSubRoute('automation', SUBS, 'overview'));
    expect(result.current[0]).toBe('overview');
  });

  it('setSub REPLACES the history entry rather than pushing one', () => {
    // Four arrow presses across a tablist must not cost four back presses to undo. Measured
    // rather than asserted on faith: `history.length` must not grow.
    window.location.hash = '#automation';
    const before = window.history.length;
    const { result } = renderHook(() => useHashSubRoute('automation', SUBS, 'overview'));
    act(() => {
      result.current[1]('time');
    });
    expect(result.current[0]).toBe('time');
    expect(window.location.hash).toBe('#automation/time');
    expect(window.history.length).toBe(before);
  });

  it('follows the hash when the browser navigates back or forward', () => {
    window.location.hash = '#automation';
    const { result } = renderHook(() => useHashSubRoute('automation', SUBS, 'overview'));
    act(() => {
      setHash('#automation/state');
    });
    expect(result.current[0]).toBe('state');
  });
});
