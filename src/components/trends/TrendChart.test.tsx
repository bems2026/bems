import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { TrendChart } from './TrendChart';
import { useDeviceStore } from '@/stores/deviceStore';
import * as bridgeClient from '@/lib/bridgeClient';

vi.mock('@/lib/bridgeClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/bridgeClient')>();
  return { ...actual, getHistory: vi.fn() };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useDeviceStore.setState({ devices: [], latestReadings: {}, totals: null, history: {} });
});

describe('TrendChart', () => {
  it('shows the empty-buffer message, not an error, when the ring buffer is genuinely empty', async () => {
    vi.mocked(bridgeClient.getHistory).mockResolvedValue({ device_id: 'co3', range: '24h', points: [] });
    render(<TrendChart deviceId="co3" title="Outlet 3" />);
    await waitFor(() => expect(screen.getByText(/buffer fills at 1 point\/min/)).toBeInTheDocument());
  });

  it('fetches with the requested range and stores the result in deviceStore', async () => {
    const points = [{ ts: new Date().toISOString(), power_w: 123.4 }];
    vi.mocked(bridgeClient.getHistory).mockResolvedValue({ device_id: 'co3', range: '1h', points });
    render(<TrendChart deviceId="co3" title="Outlet 3" range="1h" />);
    await waitFor(() => expect(useDeviceStore.getState().history.co3).toEqual(points));
    expect(bridgeClient.getHistory).toHaveBeenCalledWith('co3', '1h');
  });

  it('shows a distinct error message when the fetch itself fails', async () => {
    vi.mocked(bridgeClient.getHistory).mockRejectedValue(new Error('boom'));
    render(<TrendChart deviceId="co3" title="Outlet 3" />);
    await waitFor(() => expect(screen.getByText('History unavailable right now.')).toBeInTheDocument());
  });
});
