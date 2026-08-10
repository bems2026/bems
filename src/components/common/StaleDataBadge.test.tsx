import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { StaleDataBadge } from './StaleDataBadge';
import { useDeviceStore } from '@/stores/deviceStore';

const RESET = { devices: [], latestReadings: {}, totals: null, history: {} };

afterEach(() => {
  cleanup();
  useDeviceStore.setState(RESET);
});

describe('StaleDataBadge', () => {
  it('is stale with no reading in the store yet', () => {
    render(
      <StaleDataBadge deviceId="co3">
        <span>content</span>
      </StaleDataBadge>,
    );
    expect(screen.getByText('content').parentElement).toHaveClass('stale-wrap--stale');
    expect(screen.getByTitle('No recent reading for this device')).toBeInTheDocument();
  });

  it('is not stale for a fresh, online device reading', () => {
    useDeviceStore.setState({
      latestReadings: { co3: { device_id: 'co3', ts: new Date().toISOString(), online: true, state: 'on', power_w: 400 } },
    });
    render(
      <StaleDataBadge deviceId="co3">
        <span>content</span>
      </StaleDataBadge>,
    );
    expect(screen.getByText('content').parentElement).not.toHaveClass('stale-wrap--stale');
    expect(screen.queryByTitle('No recent reading for this device')).not.toBeInTheDocument();
  });

  it('is stale when the device is explicitly reported offline', () => {
    useDeviceStore.setState({
      latestReadings: { co3: { device_id: 'co3', ts: new Date().toISOString(), online: false, state: 'off' } },
    });
    render(
      <StaleDataBadge deviceId="co3">
        <span>content</span>
      </StaleDataBadge>,
    );
    expect(screen.getByText('content').parentElement).toHaveClass('stale-wrap--stale');
  });

  it('badges the _totals row when no deviceId is given', () => {
    useDeviceStore.setState({
      totals: {
        device_id: '_totals',
        ts: new Date(Date.now() - 60_000).toISOString(),
        energy_kwh_today: 1,
        energy_kwh_week: 1,
        energy_kwh_month: 1,
        total_power_w: 1,
        avg_voltage: 220,
        phase_current: { red: 1, yellow: 1, blue: null },
      },
    });
    render(
      <StaleDataBadge>
        <span>content</span>
      </StaleDataBadge>,
    );
    expect(screen.getByText('content').parentElement).toHaveClass('stale-wrap--stale');
  });
});
