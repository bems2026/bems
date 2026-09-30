import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { AlertsPopover } from './AlertsPopover';
import { useDeviceStore } from '@/stores/deviceStore';
import { useAnomaliesStore } from '@/stores/anomaliesStore';
import { useCommandStore } from '@/stores/commandStore';
import { useCapabilityTroubleStore } from '@/stores/capabilityTroubleStore';
import type { CapabilityEpisode } from '@/lib/capabilityEpisodes';
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
const coYellow: Device = {
  id: 'mtr_co_yellow', display_name: 'C.O Yellow', class: 'meter', room: null, dps_map: 'type_b', status: 'active',
  description: "Convenience outlets in the CARE office, and the director's office aircon",
};

const anomalyRow = (overrides: Partial<ReturnType<typeof baseRow>> = {}) => ({ ...baseRow(), ...overrides });
function baseRow() {
  return {
    device_id: 'co3', ts: new Date().toISOString(), metric: 'power_w', value: 420.5,
    baseline_mean: 100, baseline_stddev: 8, z_score: 40, iqr_lower: 70, iqr_upper: 130,
    method: 'both' as const, sample_count: 20,
  };
}
const freshReading = (id: string, power = 10) => ({ [id]: { device_id: id, ts: new Date().toISOString(), online: true, state: null, power_w: power } });

const openBell = () => fireEvent.click(screen.getByRole('button', { name: /Alerts/ }));
/** The alert rows whose text matches — the "Marked as seen: …" confirmation line is not a row. */
const rowsMatching = (re: RegExp) => screen.queryAllByRole('listitem').filter((li) => re.test(li.textContent ?? ''));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  useDeviceStore.setState({ devices: [], latestReadings: {}, totals: null, history: {} });
  useAnomaliesStore.setState({ rows: [], status: 'idle' });
  connectivity.rows = {};
  useCommandStore.setState({ pending: {}, cloudRecoveries: {} });
  useCapabilityTroubleStore.setState({ episodes: [], status: 'idle' });
});

describe('AlertsPopover — staleness and anomalies', () => {
  it('shows an anomaly in plain words, counted as needing attention', () => {
    useDeviceStore.setState({ devices: [outlet], latestReadings: freshReading('co3', 420.5) });
    useAnomaliesStore.setState({ rows: [anomalyRow()], status: 'ready' });

    render(<AlertsPopover />);
    expect(screen.getByLabelText('Alerts, 1 needs attention')).toBeInTheDocument();

    openBell();
    expect(screen.getByText('Outlet 3: unusual power')).toBeInTheDocument();
    expect(screen.getByText('421 W against its usual ~100 W recently.')).toBeInTheDocument();
    expect(screen.getByText('Warning')).toBeInTheDocument();
    // The z-score is for a technician: in the details, not in the sentence.
    expect(screen.getByText('z = 40.0')).toBeInTheDocument();
  });

  it('a stale device suppresses its anomaly row — staleness wins, no fresh value to judge', () => {
    useDeviceStore.setState({ devices: [outlet], latestReadings: {} }); // no reading at all -> stale
    useAnomaliesStore.setState({ rows: [anomalyRow()], status: 'ready' });

    render(<AlertsPopover />);
    openBell();
    expect(screen.getByText('Outlet 3: not reporting')).toBeInTheDocument();
    expect(screen.queryByText('Outlet 3: unusual power')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Alerts, 1 needs attention')).toBeInTheDocument(); // not 2
  });

  it('an anomaly older than the recency window does not show', () => {
    useDeviceStore.setState({ devices: [outlet], latestReadings: freshReading('co3', 100) });
    useAnomaliesStore.setState({ rows: [anomalyRow({ ts: new Date(Date.now() - 10 * 60 * 1000).toISOString() })], status: 'ready' });

    render(<AlertsPopover />);
    expect(screen.queryByLabelText(/needs? attention/)).not.toBeInTheDocument();
  });

  it('"Mark as seen" hides it, clears the badge, says so, and can be undone', () => {
    useDeviceStore.setState({ devices: [outlet], latestReadings: freshReading('co3', 420.5) });
    useAnomaliesStore.setState({ rows: [anomalyRow()], status: 'ready' });

    render(<AlertsPopover />);
    openBell();
    fireEvent.click(screen.getByRole('button', { name: 'Mark as seen' }));

    expect(screen.getByText('Nothing needs attention right now.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/needs? attention/)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Marked as seen: Outlet 3: unusual power.');

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByText('Outlet 3: unusual power')).toBeInTheDocument();
  });

  it('"seen" survives a reload, where Ack was forgotten — RM-152', () => {
    useDeviceStore.setState({ devices: [outlet], latestReadings: freshReading('co3', 420.5) });
    useAnomaliesStore.setState({ rows: [anomalyRow()], status: 'ready' });

    const first = render(<AlertsPopover />);
    openBell();
    fireEvent.click(screen.getByRole('button', { name: 'Mark as seen' }));
    first.unmount();

    render(<AlertsPopover />);
    expect(screen.queryByLabelText(/needs? attention/)).not.toBeInTheDocument();
  });
});

/**
 * The fleet-drop row. Its value is naming the remedy: on 2026-08-25 a Node-RED restart recovered
 * five devices that a written diagnosis had called a hardware fault.
 */
describe('AlertsPopover fleet drop', () => {
  it('raises one critical fleet row when several devices that were up today are down together', () => {
    connectivity.rows = { co1: dropped('co1'), co2: dropped('co2'), co3: dropped('co3') };
    render(<AlertsPopover />);
    openBell();
    expect(screen.getByText(/3 devices dropped together/)).toBeInTheDocument();
    expect(screen.getByText('Critical')).toBeInTheDocument();
  });

  it('tells the operator to restart Node-RED before suspecting the hardware', () => {
    connectivity.rows = { co1: dropped('co1'), co2: dropped('co2'), co3: dropped('co3') };
    render(<AlertsPopover />);
    openBell();
    expect(screen.getByText(/restarting Node-RED/i)).toBeInTheDocument();
    expect(screen.getByText(/power cycling/i)).toBeInTheDocument();
  });

  it('stays silent for devices that have never been online in the window', () => {
    // Counting the quiesced ones would pin this alert on permanently, which is how a warning
    // becomes furniture that nobody reads.
    connectivity.rows = { a: chronic('a'), b: chronic('b'), c: chronic('c'), d: chronic('d') };
    render(<AlertsPopover />);
    expect(screen.queryByText(/dropped together/)).not.toBeInTheDocument();
  });

  it('does not treat a single drop as a fleet event', () => {
    connectivity.rows = { co1: dropped('co1') };
    render(<AlertsPopover />);
    expect(screen.queryByText(/dropped together/)).not.toBeInTheDocument();
  });

  it('can be marked as seen like any other row', () => {
    connectivity.rows = { co1: dropped('co1'), co2: dropped('co2'), co3: dropped('co3') };
    render(<AlertsPopover />);
    openBell();
    const row = screen.getByText(/3 devices dropped together/).closest('li') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Mark as seen' }));
    expect(rowsMatching(/dropped together/)).toHaveLength(0);
  });
});

/**
 * The cloud-fallback row: a command that only landed through the vendor cloud succeeded while
 * meaning the device has stopped answering on the LAN.
 */
describe('AlertsPopover cloud fallback', () => {
  it('raises a row naming the device that answered only through the cloud', () => {
    useDeviceStore.setState({ devices: [outlet] });
    useCommandStore.setState({ cloudRecoveries: { co3: Date.now() } });
    render(<AlertsPopover />);
    openBell();
    expect(screen.getByText('Outlet 3: answered only through the vendor cloud')).toBeInTheDocument();
    expect(screen.getByText(/did not respond on the local network/)).toBeInTheDocument();
  });

  it('says nothing when every command took the local path', () => {
    useDeviceStore.setState({ devices: [outlet] });
    useCommandStore.setState({ cloudRecoveries: {} });
    render(<AlertsPopover />);
    expect(screen.queryByText(/vendor cloud/)).not.toBeInTheDocument();
  });

  it('keys "seen" separately from the device’s own watchdog row', () => {
    // Both rows can be about co3 at once, and they say different things.
    useDeviceStore.setState({ devices: [outlet], latestReadings: {} }); // no reading -> stale
    useCommandStore.setState({ cloudRecoveries: { co3: Date.now() } });
    render(<AlertsPopover />);
    openBell();
    const cloudRow = screen.getByText(/answered only through the vendor cloud/).closest('li') as HTMLElement;
    fireEvent.click(within(cloudRow).getByRole('button', { name: 'Mark as seen' }));
    expect(rowsMatching(/vendor cloud/)).toHaveLength(0);
    expect(screen.getByText('Outlet 3: not reporting')).toBeInTheDocument();
  });
});

/**
 * What the DEVICE reported, from phase28 history — RM-152.
 *
 * The live case: C.O Yellow's meter (limit 2,000 W) read above its limit from 08:01 to 16:06 on
 * 23 Sep 2026. A week later the bell still listed it as outstanding, and it came back every five
 * minutes with a new "for X min", because its key was its start and the week's edge kept moving it.
 */
describe('AlertsPopover — what the device reported', () => {
  const sep23: CapabilityEpisode = {
    device_id: 'mtr_co_yellow', kind: 'power_warn', value: 'warn',
    from: '2026-09-23T00:01:00Z', to: '2026-09-23T08:06:14Z', samples: 117, peakW: 2982.8, limitW: 2000,
  };
  const sep17: CapabilityEpisode = { ...sep23, from: '2026-09-17T01:20:39Z', to: '2026-09-17T06:57:00Z', samples: 2, peakW: 1575.5 };
  const setup = (episodes: CapabilityEpisode[]) => {
    useDeviceStore.setState({ devices: [coYellow, outlet], latestReadings: { ...freshReading('mtr_co_yellow'), ...freshReading('co3') } });
    useCapabilityTroubleStore.setState({ status: 'ready', episodes });
  };

  it('a warning that ended is under "Earlier this week", in plain words, and is NOT counted as needing attention', () => {
    setup([sep23]);
    render(<AlertsPopover />);
    expect(screen.getByLabelText('Alerts')).toBeInTheDocument(); // no count
    openBell();
    const earlier = screen.getByRole('region', { name: 'Earlier this week' });
    expect(within(earlier).getByText('C.O Yellow: power above its limit')).toBeInTheDocument();
    expect(within(earlier).getByText(/The meter's own limit is 2,000 W\. It read above it from 08:01 to 16:06/)).toBeInTheDocument();
    expect(within(earlier).getByText(/peaking at 2,983 W/)).toBeInTheDocument();
    expect(within(earlier).getByText(/Convenience outlets in the CARE office/)).toBeInTheDocument();
    expect(within(earlier).getByText('Notice')).toBeInTheDocument();
    expect(within(earlier).getByText(/From the meter/)).toBeInTheDocument();
    expect(screen.queryByText(/verdict|threshold this system/i)).not.toBeInTheDocument();
    expect(screen.getByText('Nothing needs attention right now.')).toBeInTheDocument();
  });

  it('one device’s warnings are ONE row, the older ones a click away', () => {
    setup([sep23, sep17]);
    render(<AlertsPopover />);
    openBell();
    expect(screen.getAllByText('C.O Yellow: power above its limit')).toHaveLength(1);
    expect(screen.getByText('1 earlier this week')).toBeInTheDocument();
  });

  it('dismissed, it stays dismissed as the week’s edge cuts into it, and across a reload', () => {
    setup([sep23]);
    const first = render(<AlertsPopover />);
    openBell();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('C.O Yellow: power above its limit')).not.toBeInTheDocument();
    first.unmount();

    // Five minutes later: the same episode, its start now at the window's edge.
    setup([{ ...sep23, from: '2026-09-23T05:46:51Z', samples: 48, clipped: true }]);
    render(<AlertsPopover />);
    openBell();
    expect(screen.queryByText('C.O Yellow: power above its limit')).not.toBeInTheDocument();
  });

  it('a warning that is on NOW needs attention, and a newer episode after "seen" comes back', () => {
    const now = Date.now();
    const live: CapabilityEpisode = { ...sep23, from: new Date(now - 30 * 60_000).toISOString(), to: new Date(now - 60_000).toISOString() };
    setup([live]);
    const first = render(<AlertsPopover />);
    expect(screen.getByLabelText('Alerts, 1 needs attention')).toBeInTheDocument();
    openBell();
    const attention = screen.getByRole('region', { name: 'Needs attention' });
    expect(within(attention).getByText(/has been above it since/)).toBeInTheDocument();
    expect(within(attention).getByText('Warning')).toBeInTheDocument();
    fireEvent.click(within(attention).getByRole('button', { name: 'Mark as seen' }));
    expect(screen.queryByLabelText(/needs? attention/)).not.toBeInTheDocument();
    first.unmount();

    // It stopped, then started again: a new episode is new news.
    setup([live, { ...live, from: new Date(now - 2 * 60_000).toISOString(), to: new Date(now - 30_000).toISOString() }]);
    render(<AlertsPopover />);
    expect(screen.getByLabelText('Alerts, 1 needs attention')).toBeInTheDocument();
  });

  it('a fault the outlet raised itself, on now, is critical and decoded', () => {
    const now = Date.now();
    setup([{ device_id: 'co3', kind: 'fault', value: 1, from: new Date(now - 5 * 60_000).toISOString(), to: new Date(now - 60_000).toISOString(), samples: 5 }]);
    render(<AlertsPopover />);
    openBell();
    expect(screen.getByText('Outlet 3: device fault')).toBeInTheDocument();
    expect(screen.getByText(/over-current/)).toBeInTheDocument();
    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(screen.getByText(/From the device/)).toBeInTheDocument();
  });

  it('a healthy fleet adds nothing — an empty episode list is the normal case', () => {
    setup([]);
    render(<AlertsPopover />);
    expect(screen.getByLabelText('Alerts')).toBeInTheDocument();
    openBell();
    expect(screen.getByText('Nothing needs attention right now.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Earlier this week' })).not.toBeInTheDocument();
  });

  it('links to the device, and keeps the raw id in the details', () => {
    setup([sep23]);
    render(<AlertsPopover />);
    openBell();
    expect(screen.getByRole('link', { name: 'Open device' })).toHaveAttribute('href', '#devices/mtr_co_yellow');
    expect(screen.getByText('Device id: mtr_co_yellow')).toBeInTheDocument();
  });
});
