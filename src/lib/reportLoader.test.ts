import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createReportCache,
  isTransient,
  retryTransient,
  ReportTimeoutError,
  withTimeout,
} from './reportLoader';

/**
 * RM-081. The Reports page's loaders had no timeout, no retry and no cache: one hung request left
 * a silently empty page, and one failed request blanked every figure until a reload. These are the
 * three primitives the page now loads through, and each one's failure mode is the thing asserted.
 */

afterEach(() => {
  vi.useRealTimers();
});

describe('withTimeout', () => {
  it('resolves with the value when the request finishes in time, and leaves no timer behind', async () => {
    vi.useFakeTimers();
    const value = await withTimeout(async () => 42, 1000, 'fast');
    expect(value).toBe(42);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with a named timeout, and aborts the request it gave up on', async () => {
    // A timeout that only stops WAITING leaves the request running on the Pi's uplink. The signal
    // is how the request itself is told.
    vi.useFakeTimers();
    let seen: AbortSignal | null = null;
    const pending = withTimeout(
      (signal) => {
        seen = signal;
        return new Promise(() => {});
      },
      1000,
      'report_hour_matrix'
    );
    const assertion = expect(pending).rejects.toBeInstanceOf(ReportTimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(seen!.aborted).toBe(true);
    await expect(pending).rejects.toThrow(/report_hour_matrix/);
  });

  it('passes a request failure through unchanged', async () => {
    await expect(withTimeout(async () => { throw new Error('RLS said no'); }, 1000, 'x')).rejects.toThrow('RLS said no');
  });
});

describe('isTransient', () => {
  it.each([
    ['a timeout', new ReportTimeoutError('report_daily_series', 20000)],
    ['a browser network failure', new TypeError('Failed to fetch')],
    ['a network failure wrapped by a loader', new Error('report_daily_series failed: TypeError: Failed to fetch')],
    ['Firefox\'s wording', new TypeError('NetworkError when attempting to fetch resource.')],
    ['Safari\'s wording', new TypeError('Load failed')],
  ])('retries %s', (_name, err) => {
    expect(isTransient(err)).toBe(true);
  });

  it.each([
    // Asking again cannot change these answers, and retrying them only delays saying so.
    ['a permission refusal', new Error('report_daily_series failed: permission denied for function report_daily_series')],
    ['a truncated result', new Error('report_hour_matrix({}) returned 900 rows, at or above the 900-row cap')],
    ['a caller cancelling', new DOMException('The operation was aborted.', 'AbortError')],
    ['something that is not an error at all', 'nope'],
  ])('does not retry %s', (_name, err) => {
    expect(isTransient(err)).toBe(false);
  });
});

describe('retryTransient', () => {
  const noSleep = () => Promise.resolve();

  it('tries again after a transient failure, and returns the answer that arrives', async () => {
    const run = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce('rows');
    await expect(retryTransient(run, { retries: 2, baseMs: 600, sleep: noSleep })).resolves.toBe('rows');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('never retries a failure that asking again cannot fix', async () => {
    const run = vi.fn().mockRejectedValue(new Error('permission denied for function report_daily_series'));
    await expect(retryTransient(run, { retries: 2, baseMs: 600, sleep: noSleep })).rejects.toThrow(/permission denied/);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('gives up after its retries and reports the last failure', async () => {
    const run = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(retryTransient(run, { retries: 2, baseMs: 600, sleep: noSleep })).rejects.toThrow('Failed to fetch');
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('backs off exponentially, with jitter applied to each wait', async () => {
    const waits: number[] = [];
    const run = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(
      retryTransient(run, {
        retries: 2,
        baseMs: 600,
        sleep: (ms) => {
          waits.push(ms);
          return Promise.resolve();
        },
        // Mid-range jitter: 0.5 + 0.5 = a factor of exactly 1.
        random: () => 0.5,
      })
    ).rejects.toThrow();
    expect(waits).toEqual([600, 1200]);
  });
});

describe('createReportCache', () => {
  it('shares one request between two callers asking for the same report at once', async () => {
    // Stepping back and forth across two periods is exactly how a kiosk operator browses, and it
    // used to fire every query again each time.
    const cache = createReportCache<string>({ max: 4 });
    let release!: (v: string) => void;
    const load = vi.fn(() => new Promise<string>((r) => { release = r; }));
    const a = cache.get('month:2026-08-01:core', load);
    const b = cache.get('month:2026-08-01:core', load);
    release('august');
    await expect(Promise.all([a, b])).resolves.toEqual(['august', 'august']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('answers a report it already has without asking again, and can say so synchronously', async () => {
    const cache = createReportCache<string>({ max: 4 });
    await cache.get('k', async () => 'v');
    const load = vi.fn(async () => 'again');
    expect(cache.peek('k')).toBe('v');
    await expect(cache.get('k', load)).resolves.toBe('v');
    expect(load).not.toHaveBeenCalled();
  });

  it('never keeps a failure, so the next ask really asks', async () => {
    const cache = createReportCache<string>({ max: 4 });
    await expect(cache.get('k', async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    expect(cache.peek('k')).toBeUndefined();
    await expect(cache.get('k', async () => 'back')).resolves.toBe('back');
  });

  it('forgets the least recently used report once it holds its maximum', async () => {
    const cache = createReportCache<string>({ max: 2 });
    await cache.get('a', async () => 'A');
    await cache.get('b', async () => 'B');
    await cache.get('a', async () => 'A2'); // touches a, so b is now the oldest
    await cache.get('c', async () => 'C');
    expect(cache.peek('a')).toBe('A');
    expect(cache.peek('b')).toBeUndefined();
    expect(cache.peek('c')).toBe('C');
  });

  it('drops one entry on request, which is what Retry does', async () => {
    const cache = createReportCache<string>({ max: 4 });
    await cache.get('k', async () => 'stale');
    cache.invalidate('k');
    expect(cache.peek('k')).toBeUndefined();
  });

  it('lets an answer expire, so a kiosk left on the page still sees the week that settled overnight', async () => {
    // The list of periods is not immutable: the ingest daemon adds a week every Monday-plus-grace.
    // A cache that never expired would hide it for as long as the page stayed open.
    let now = 0;
    const cache = createReportCache<string>({ max: 4, ttlMs: 1000, now: () => now });
    await cache.get('k', async () => 'old');
    now = 999;
    expect(cache.peek('k')).toBe('old');
    now = 1000;
    expect(cache.peek('k')).toBeUndefined();
    await expect(cache.get('k', async () => 'new')).resolves.toBe('new');
  });

  it('can be emptied', async () => {
    const cache = createReportCache<string>({ max: 4 });
    await cache.get('a', async () => 'A');
    cache.clear();
    expect(cache.peek('a')).toBeUndefined();
  });
});
