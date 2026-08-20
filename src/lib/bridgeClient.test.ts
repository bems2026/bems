import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nextPollDelayMs, isStale, fetchJson } from './bridgeClient';
import { setAuthFailureHandler, setAuthToken } from './authToken';
import { TIMING } from './timing';

describe('nextPollDelayMs', () => {
  it('polls every 15s while healthy', () => {
    expect(nextPollDelayMs(0)).toBe(15_000);
  });

  it('doubles per consecutive failure: 30, 60, 120s', () => {
    expect(nextPollDelayMs(1)).toBe(30_000);
    expect(nextPollDelayMs(2)).toBe(60_000);
    expect(nextPollDelayMs(3)).toBe(120_000);
  });

  it('caps at 120s and stays there beyond 4 failures', () => {
    expect(nextPollDelayMs(4)).toBe(120_000);
    expect(nextPollDelayMs(5)).toBe(120_000);
    expect(nextPollDelayMs(100)).toBe(TIMING.BACKOFF_CAP_MS);
  });

  it('treats negative input the same as healthy (defensive, should never occur)', () => {
    expect(nextPollDelayMs(-1)).toBe(15_000);
  });
});

describe('isStale', () => {
  const now = 1_786_000_000_000;

  it('is stale with no prior update', () => {
    expect(isStale(null, now)).toBe(true);
  });

  it('is not stale just under the 30s threshold', () => {
    expect(isStale(now - 29_999, now)).toBe(false);
  });

  it('is stale exactly at and beyond the 30s threshold', () => {
    expect(isStale(now - 30_000, now)).toBe(false); // strictly greater-than, not >=
    expect(isStale(now - 30_001, now)).toBe(true);
  });

  it('is not stale for a reading from the future (clock skew tolerance)', () => {
    expect(isStale(now + 5_000, now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 401 handling — the kiosk death-loop fix.
//
// Before this, `fetchJson` treated a 401 exactly like a network blip: `pollLoop`'s catch
// incremented `pollFailures` and retried forever with the same dead token, while
// `authStore` was never told and kept reporting `status: 'authenticated'`. The live Pi's
// proxy logged 4383 such 401s in 24h from the office kiosk tab, which sat there showing a
// normal-looking dashboard with silently frozen data.
//
// A browser can't observe a 401 on a WebSocket upgrade (it surfaces as a generic close
// 1006), so the HTTP path is the only reliable detector — which is why the hook lives in
// `fetchJson` and not in `connectLive`.
// ---------------------------------------------------------------------------

describe('fetchJson auth-failure notification', () => {
  const handler = vi.fn();

  beforeEach(() => {
    handler.mockReset();
    setAuthFailureHandler(handler);
  });

  afterEach(() => {
    setAuthFailureHandler(null);
    setAuthToken(null);
    vi.unstubAllGlobals();
  });

  const stubFetch = (init: { status: number; body?: unknown }) =>
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: init.status >= 200 && init.status < 300,
        status: init.status,
        json: async () => init.body ?? {},
      }),
    );

  it('notifies on 401, and still throws so the caller\'s own retry policy is unchanged', async () => {
    stubFetch({ status: 401, body: { error: 'unauthorized' } });
    await expect(fetchJson('/devices')).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does NOT notify on 500 — a bridge fault is not an auth problem, and signing the operator out over one would be its own outage', async () => {
    stubFetch({ status: 500 });
    await expect(fetchJson('/devices')).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it('does NOT notify on 403 — break_glass_cannot_command is a valid session being refused one action, not a dead session', async () => {
    stubFetch({ status: 403, body: { error: 'break_glass_cannot_command' } });
    await expect(fetchJson('/command', { method: 'POST', body: {} })).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it('does NOT notify when the request never got a response at all', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchJson('/devices')).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it('does NOT notify on a successful request', async () => {
    stubFetch({ status: 200, body: [] });
    await expect(fetchJson('/devices')).resolves.toEqual([]);
    expect(handler).not.toHaveBeenCalled();
  });
});
