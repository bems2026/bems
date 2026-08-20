import { describe, it, expect, vi, afterEach } from 'vitest';
import { setAuthToken, getAuthToken, setAuthFailureHandler, notifyAuthFailure } from './authToken';

afterEach(() => {
  setAuthToken(null);
  setAuthFailureHandler(null);
});

describe('token accessors', () => {
  it('round-trips a token', () => {
    setAuthToken('abc');
    expect(getAuthToken()).toBe('abc');
  });

  it('clears back to null', () => {
    setAuthToken('abc');
    setAuthToken(null);
    expect(getAuthToken()).toBeNull();
  });
});

describe('auth failure handler', () => {
  it('invokes the registered handler', () => {
    const handler = vi.fn();
    setAuthFailureHandler(handler);
    notifyAuthFailure();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('is a no-op with no handler registered — bridgeClient must not need to know whether a store is listening', () => {
    expect(() => notifyAuthFailure()).not.toThrow();
  });

  it('never lets a throwing handler escape into the caller, which is mid-request in fetchJson', () => {
    setAuthFailureHandler(() => {
      throw new Error('store blew up');
    });
    expect(() => notifyAuthFailure()).not.toThrow();
  });

  it('replaces rather than stacks handlers, so a re-run of authStore.init() cannot double-fire a refresh', () => {
    const first = vi.fn();
    const second = vi.fn();
    setAuthFailureHandler(first);
    setAuthFailureHandler(second);
    notifyAuthFailure();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
