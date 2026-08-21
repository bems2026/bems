import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup, act } from '@testing-library/react';
import { useNowTick, __resetNowTickForTests } from './useNowTick';

/**
 * The point of this hook is that there is exactly ONE interval no matter how many
 * components use it — StaleDataBadge alone is mounted a dozen times on the Control page.
 * These tests assert the refcounting directly, by counting real timer creation, rather than
 * asserting the rendered output that motivated it.
 */
describe('useNowTick', () => {
  beforeEach(() => {
    __resetNowTickForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    __resetNowTickForTests();
    vi.useRealTimers();
  });

  it('creates one interval for the first subscriber', () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    renderHook(() => useNowTick());
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('creates no further intervals however many components subscribe', () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    renderHook(() => useNowTick());
    renderHook(() => useNowTick());
    renderHook(() => useNowTick());
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('stops the interval once the last subscriber unmounts', () => {
    // A timer left running on a page with no clock on it is exactly the waste this replaces.
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const a = renderHook(() => useNowTick());
    const b = renderHook(() => useNowTick());

    a.unmount();
    expect(clearSpy).not.toHaveBeenCalled();

    b.unmount();
    expect(clearSpy).toHaveBeenCalled();
  });

  it('restarts cleanly after every subscriber has gone', () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    renderHook(() => useNowTick()).unmount();
    renderHook(() => useNowTick());
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('advances the returned time once a second', () => {
    const { result } = renderHook(() => useNowTick());
    const first = result.current;
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current).toBeGreaterThan(first);
  });

  it('returns the same value between ticks, so it cannot loop the renderer', () => {
    // useSyncExternalStore re-renders forever if getSnapshot returns a fresh value each
    // call — the reason `now` is a module variable rather than a Date.now() call.
    const { result, rerender } = renderHook(() => useNowTick());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('gives every subscriber the same instant, so they update in phase', () => {
    // Separate intervals drifted relative to each other and each scheduled its own render.
    // Sharing one lets React batch them into a single pass.
    const a = renderHook(() => useNowTick());
    const b = renderHook(() => useNowTick());
    act(() => { vi.advanceTimersByTime(1000); });
    expect(a.result.current).toBe(b.result.current);
  });
});
