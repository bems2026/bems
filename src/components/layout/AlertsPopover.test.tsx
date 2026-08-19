import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { AlertsPopover } from './AlertsPopover';
import { useDeviceStore } from '@/stores/deviceStore';
import { useAnomaliesStore } from '@/stores/anomaliesStore';
import type { Device } from '@/lib/types';

const outlet: Device = { id: 'co3', display_name: 'Outlet 3', class: 'outlet_dual', room: null, dps_map: 'type_b', status: 'active' };

const anomalyRow = (overrides: Partial<ReturnType<typeof baseRow>> = {}) => ({ ...baseRow(), ...overrides });
function baseRow() {
  return {
    device_id: 'co3', ts: new Date().toISOString(), metric: 'power_w', value: 420.5,
    baseline_mean: 100, baseline_stddev: 8, z_score: 40, iqr_lower: 70, iqr_upper: 130,
    method: 'both' as const, sample_count: 20,
  };
}

afterEach(() => {
  cleanup();
  useDeviceStore.setState({ devices: [], latestReadings: {}, totals: null, history: {} });
  useAnomaliesStore.setState({ rows: [], status: 'idle' });
});

describe('AlertsPopover — merged staleness + anomaly sources', () => {
  it('shows an anomaly row distinct from a watchdog row, badges the combined count', async () => {
    useDeviceStore.setState({ devices: [outlet], latestReadings: { co3: { device_id: 'co3', ts: new Date().toISOString(), online: true, state: null, power_w: 420.5 } } });
    useAnomaliesStore.setState({ rows: [anomalyRow()], status: 'ready' });

    render(<AlertsPopover />);
    expect(screen.getByLabelText('Alerts, 1 unacknowledged')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Alerts/ }));
    expect(screen.getByText('Outlet 3 reading abnormal power')).toBeInTheDocument();
    expect(screen.getByText('421W vs. its usual ~100W recently.')).toBeInTheDocument();
    expect(screen.getByText('co3 · anomaly · z=40.0')).toBeInTheDocument();
  });

  it('a stale device suppresses its anomaly row — staleness wins, no fresh value to judge', async () => {
    useDeviceStore.setState({ devices: [outlet], latestReadings: {} }); // no reading at all -> stale
    useAnomaliesStore.setState({ rows: [anomalyRow()], status: 'ready' });

    render(<AlertsPopover />);
    fireEvent.click(screen.getByRole('button', { name: /Alerts/ }));

    expect(screen.getByText('Outlet 3 in COMM FAULT')).toBeInTheDocument();
    expect(screen.queryByText('Outlet 3 reading abnormal power')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Alerts, 1 unacknowledged')).toBeInTheDocument(); // not 2
  });

  it('an anomaly older than the recency window does not show', async () => {
    useDeviceStore.setState({ devices: [outlet], latestReadings: { co3: { device_id: 'co3', ts: new Date().toISOString(), online: true, state: null, power_w: 100 } } });
    useAnomaliesStore.setState({ rows: [anomalyRow({ ts: new Date(Date.now() - 10 * 60 * 1000).toISOString() })], status: 'ready' });

    render(<AlertsPopover />);
    expect(screen.queryByLabelText(/unacknowledged/)).not.toBeInTheDocument();
  });

  it('acking an anomaly row removes it and clears the badge, same Set the watchdog rows already use', async () => {
    useDeviceStore.setState({ devices: [outlet], latestReadings: { co3: { device_id: 'co3', ts: new Date().toISOString(), online: true, state: null, power_w: 420.5 } } });
    useAnomaliesStore.setState({ rows: [anomalyRow()], status: 'ready' });

    render(<AlertsPopover />);
    fireEvent.click(screen.getByRole('button', { name: /Alerts/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Ack' }));

    expect(screen.getByText('Nothing outstanding')).toBeInTheDocument();
    expect(screen.queryByLabelText(/unacknowledged/)).not.toBeInTheDocument();
  });
});
