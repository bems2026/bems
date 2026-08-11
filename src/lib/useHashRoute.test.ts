import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useHashRoute, navigateTo } from './useHashRoute';

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
