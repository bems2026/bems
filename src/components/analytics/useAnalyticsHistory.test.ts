import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { useAnalyticsHistory, type AnalyticsRange } from './useAnalyticsHistory';
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
