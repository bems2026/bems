import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { useAnalyticsHistory } from './useAnalyticsHistory';
import { useDeviceStore, historyFor } from '@/stores/deviceStore';
import * as bridgeClient from '@/lib/bridgeClient';
import type { Device } from '@/lib/types';

vi.mock('@/lib/bridgeClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/bridgeClient')>();
  return { ...actual, getHistory: vi.fn() };
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
