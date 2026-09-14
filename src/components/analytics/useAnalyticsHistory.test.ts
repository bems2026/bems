import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup, act } from '@testing-library/react';
import { useAnalyticsHistory, RETRY_BASE_MS, type AnalyticsRange } from './useAnalyticsHistory';
import { useDeviceStore, historyFor } from '@/stores/deviceStore';
import * as bridgeClient from '@/lib/bridgeClient';
import * as supabaseHistory from '@/lib/supabaseHistory';
import type { Device } from '@/lib/types';

vi.mock('@/lib/bridgeClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/bridgeClient')>();
  return { ...actual, getHistory: vi.fn() };
});

// The long-range path needs a configured Supabase to be reachable at all — the hook bails
// to 'error' without one (longRangeUnavailable), which would mask the status transition
// under test.
vi.mock('@/config/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/supabaseHistory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabaseHistory')>();
  return { ...actual, getLongHistory: vi.fn() };
});

const meter = (id: string): Device => ({ id, display_name: id, class: 'meter', room: null, dps_map: 'type_a', status: 'active' });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useDeviceStore.setState({ devices: [], latestReadings: {}, totals: null, history: {} });
});

describe('useAnalyticsHistory — 24h (bridge-backed)', () => {
  it('one device failing its history fetch does not blank every other device — partial data beats no data', async () => {
    useDeviceStore.setState({ devices: [meter('mtr_ok'), meter('mtr_flaky')] });
    vi.mocked(bridgeClient.getHistory).mockImplementation(async (deviceId) => {
      if (deviceId === 'mtr_flaky') throw new Error('timed out');
      return { device_id: deviceId, range: '24h', points: [{ ts: 't1', power_w: 100 }] };
    });

    const { result } = renderHook(() => useAnalyticsHistory('24h'));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    // Read through historyFor, not the raw map: history is tagged with the range it was
    // fetched for, so that points from one window can never be charted as another.
    expect(historyFor(useDeviceStore.getState().history, 'mtr_ok', '24h')).toEqual([{ ts: 't1', power_w: 100 }]);
    // The flaky device's history simply stays unset — a gap, not a fabricated series —
    // rather than the whole hook reporting 'error' and every device losing its chart.
    expect(historyFor(useDeviceStore.getState().history, 'mtr_flaky', '24h')).toEqual([]);
  });

  it('reports error only when every device fails, not just one', async () => {
    useDeviceStore.setState({ devices: [meter('mtr_a'), meter('mtr_b')] });
    vi.mocked(bridgeClient.getHistory).mockRejectedValue(new Error('bridge unreachable'));

    const { result } = renderHook(() => useAnalyticsHistory('24h'));

    await waitFor(() => expect(result.current.status).toBe('error'));
  });
});

describe('status during a range change', () => {
  it('goes back to loading when the range changes, so the page shows a skeleton not a claim', async () => {
    // The visible symptom: switching 24h -> 7d flashed "No 7d history yet — data
    // accumulates going forward from when ingestion started" for about a second. status was
    // only ever assigned inside load(), so it still read 'ready' from the previous range and
    // the page skipped its skeleton branch. That sentence is a claim about the data, and it
    // was false — the history existed, it just hadn't arrived yet.
    useDeviceStore.setState({ devices: [meter('mtr_a')], history: {} });
    vi.mocked(bridgeClient.getHistory).mockResolvedValue({
      device_id: 'mtr_a', range: '24h', points: [{ ts: 't1', power_w: 100 }],
    });

    const { result, rerender } = renderHook(({ r }) => useAnalyticsHistory(r), {
      initialProps: { r: '24h' as AnalyticsRange },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    vi.mocked(supabaseHistory.getLongHistory).mockImplementation(
      () => new Promise(() => {}) // never resolves — hold it mid-flight
    );
    rerender({ r: '7d' as AnalyticsRange });

    expect(result.current.status).toBe('loading');
  });

  it('does not drop back to loading on a routine refetch of the same range', async () => {
    // load() reschedules itself every 60s (24h) or 5min (long range); resetting there would
    // flash the skeleton on every poll instead of only on a real range change.
    useDeviceStore.setState({ devices: [meter('mtr_a')], history: {} });
    vi.mocked(bridgeClient.getHistory).mockResolvedValue({
      device_id: 'mtr_a', range: '24h', points: [{ ts: 't1', power_w: 100 }],
    });

    const { result, rerender } = renderHook(({ r }) => useAnalyticsHistory(r), {
      initialProps: { r: '24h' as AnalyticsRange },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    rerender({ r: '24h' as AnalyticsRange }); // same range — nothing should change
    expect(result.current.status).toBe('ready');
  });
});

/*
 * RM-076 — synchronisation. The page used to know only "loading", "ready" or "error", so history
 * that stopped arriving an hour ago looked exactly as current as history fetched a second ago, and a
 * failed fetch waited a full cycle before trying again.
 */
describe('sync status', () => {
  it('reports when the range last arrived, from which source, with no failures', async () => {
    useDeviceStore.setState({ devices: [meter('mtr_a')], history: {} });
    vi.mocked(bridgeClient.getHistory).mockResolvedValue({ device_id: 'mtr_a', range: '24h', points: [{ ts: 't1', power_w: 100 }] });

    const { result } = renderHook(() => useAnalyticsHistory('24h'));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current.sync).toMatchObject({ settled: true, failures: 0, lastError: null, source: 'bridge' });
    expect(typeof result.current.sync.fetchedAt).toBe('number');
  });

  it('counts consecutive failures and retries sooner than the normal cadence', async () => {
    vi.useFakeTimers();
    try {
      useDeviceStore.setState({ devices: [meter('mtr_a')], history: {} });
      vi.mocked(bridgeClient.getHistory).mockRejectedValue(new Error('bridge unreachable'));

      const { result } = renderHook(() => useAnalyticsHistory('24h'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.sync).toMatchObject({ failures: 1, lastError: 'bridge unreachable', fetchedAt: null });

      const callsBefore = vi.mocked(bridgeClient.getHistory).mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(RETRY_BASE_MS);
      });
      expect(vi.mocked(bridgeClient.getHistory).mock.calls.length).toBeGreaterThan(callsBefore);
      expect(result.current.sync.failures).toBe(2);
      expect(RETRY_BASE_MS).toBeLessThan(60_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps today's 24h history for the building meters while the chart shows a week", async () => {
    // The Energy section checks each branch for a frozen meter against today's samples. Switching
    // the chart to 7d must not leave it with nothing to check against.
    useDeviceStore.setState({ devices: [meter('mtr_lo_red')], history: {} });
    vi.mocked(bridgeClient.getHistory).mockResolvedValue({ device_id: 'mtr_lo_red', range: '24h', points: [{ ts: 't0', power_w: 13.3 }] });
    vi.mocked(supabaseHistory.getLongHistory).mockResolvedValue([{ ts: 't1', power_w: 12 }]);

    const { result } = renderHook(() => useAnalyticsHistory('7d'));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await waitFor(() => expect(historyFor(useDeviceStore.getState().history, 'mtr_lo_red', '24h')).toEqual([{ ts: 't0', power_w: 13.3 }]));
    expect(historyFor(useDeviceStore.getState().history, 'mtr_lo_red', '7d')).toEqual([{ ts: 't1', power_w: 12 }]);
    expect(result.current.sync.source).toBe('stored');
  });
});
