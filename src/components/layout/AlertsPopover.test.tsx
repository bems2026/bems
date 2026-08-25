import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { AlertsPopover } from './AlertsPopover';
import { useDeviceStore } from '@/stores/deviceStore';
import { useAnomaliesStore } from '@/stores/anomaliesStore';
import type { Device } from '@/lib/types';

// The bell reads fleet connectivity through this hook; the real one talks to Supabase.
const connectivity = vi.hoisted(() => ({ rows: {} as Record<string, unknown> }));
vi.mock('@/hooks/useDeviceConnectivity', () => ({
  useDeviceConnectivity: () => ({ rows: connectivity.rows, status: 'ready' }),
}));

/** A connectivity row that was up for most of the window and is down now. */
const dropped = (id: string) => ({
  device_id: id, samples: 1440, online_samples: 900, transitions: 4,
  last_change: null, currently_online: false,
});
/** Down now and never up in the window — the permanently quiesced shape. */
const chronic = (id: string) => ({
  device_id: id, samples: 1440, online_samples: 0, transitions: 0,
  last_change: null, currently_online: false,
});

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
  connectivity.rows = {};
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

/**
 * The fleet-drop row. Its value is not the count — the per-device COMM FAULT rows already
 * carry that — it is naming the remedy. On 2026-08-25 a Node-RED restart recovered five
 * devices that a written diagnosis had called a hardware fault, and nothing on screen had ever
 * suggested trying it.
 */
describe('AlertsPopover fleet drop', () => {
  it('raises one fleet row when several devices that were up today are down together', () => {
    connectivity.rows = { co1: dropped('co1'), co2: dropped('co2'), co3: dropped('co3') };
    render(<AlertsPopover />);
    fireEvent.click(screen.getByRole('button', { name: /Alerts/ }));
    expect(screen.getByText(/3 devices dropped together/)).toBeInTheDocument();
  });

  it('tells the operator to restart Node-RED before suspecting the hardware', () => {
    connectivity.rows = { co1: dropped('co1'), co2: dropped('co2'), co3: dropped('co3') };
    render(<AlertsPopover />);
    fireEvent.click(screen.getByRole('button', { name: /Alerts/ }));
    expect(screen.getByText(/restarting Node-RED/i)).toBeInTheDocument();
    expect(screen.getByText(/power cycling/i)).toBeInTheDocument();
  });

  it('stays silent for devices that have never been online in the window', () => {
    // The IR blaster and outside-temp sensor are quiesced on purpose and live here forever.
    // Counting them would pin this alert on permanently, which is how a warning becomes
    // furniture that nobody reads.
    connectivity.rows = { a: chronic('a'), b: chronic('b'), c: chronic('c'), d: chronic('d') };
    render(<AlertsPopover />);
    expect(screen.queryByText(/dropped together/)).not.toBeInTheDocument();
  });

  it('does not treat a single drop as a fleet event', () => {
    connectivity.rows = { co1: dropped('co1') };
    render(<AlertsPopover />);
    expect(screen.queryByText(/dropped together/)).not.toBeInTheDocument();
  });

  it('can be acknowledged like any other row', () => {
    connectivity.rows = { co1: dropped('co1'), co2: dropped('co2'), co3: dropped('co3') };
    render(<AlertsPopover />);
    fireEvent.click(screen.getByRole('button', { name: /Alerts/ }));
    // Scoped to the fleet row: the popover renders one Ack per item, so an unscoped query
    // matches whichever rows happen to coexist.
    const row = screen.getByText(/3 devices dropped together/).closest('li') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /Ack/i }));
    expect(screen.queryByText(/dropped together/)).not.toBeInTheDocument();
  });
});
