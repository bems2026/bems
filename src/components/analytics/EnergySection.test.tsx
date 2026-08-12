import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { EnergySection } from './EnergySection';
import { useDeviceStore } from '@/stores/deviceStore';
import type { Device, Reading, Totals } from '@/lib/types';

const meter = (id: string, name: string): Device => ({
  id,
  display_name: name,
  class: 'meter',
  room: null,
  dps_map: 'type_a',
  status: 'active',
});

const reading = (id: string, energy: number | undefined): Reading => ({
  device_id: id,
  ts: new Date().toISOString(),
  online: true,
  state: null,
  ...(energy === undefined ? {} : { energy_kwh_today: energy }),
});

const totals = (over: Partial<Totals> = {}): Totals => ({
  device_id: '_totals',
  ts: new Date().toISOString(),
  energy_kwh_today: 46.55,
  energy_kwh_week: 87.75,
  energy_kwh_month: 230.15,
  total_power_w: 910,
  avg_voltage: 220,
  phase_current: { red: 1.5, yellow: 2.6, blue: null },
  ...over,
});

const BRANCHES = [meter('mtr_a', 'C.O Yellow'), meter('mtr_b', 'L.O Red')];

afterEach(() => {
  cleanup();
  useDeviceStore.setState({ devices: [], latestReadings: {}, totals: null, history: {} });
});

describe('EnergySection', () => {
  it('renders the three counters the bridge reports', () => {
    useDeviceStore.setState({ totals: totals() });
    render(<EnergySection branchDevices={[]} />);
    expect(screen.getByText('46.55')).toBeInTheDocument();
    expect(screen.getByText('87.75')).toBeInTheDocument();
    expect(screen.getByText('230.15')).toBeInTheDocument();
  });

  /*
   * The whole point of the null branch: `Totals`' energy fields are `number | null`, and a
   * null means the bridge never counted that period. Rendering it as "0.00 kWh" would
   * claim the building consumed nothing — the same "no data is not zero" rule `types.ts`
   * states for readings.
   */
  it('renders an uncounted period as "No data", never as a zero reading', () => {
    useDeviceStore.setState({ totals: totals({ energy_kwh_week: null, energy_kwh_month: null }) });
    render(<EnergySection branchDevices={[]} />);
    expect(screen.getAllByText('No data')).toHaveLength(2);
    expect(screen.queryByText('0.00')).not.toBeInTheDocument();
  });

  it('shows no counters at all before the first totals frame arrives', () => {
    render(<EnergySection branchDevices={[]} />);
    expect(screen.getAllByText('No data')).toHaveLength(3);
  });

  it("splits today's energy by branch, largest first, as a share of the branches shown", () => {
    useDeviceStore.setState({
      totals: totals(),
      latestReadings: { mtr_a: reading('mtr_a', 25), mtr_b: reading('mtr_b', 75) },
    });
    render(<EnergySection branchDevices={BRANCHES} />);
    const rows = document.querySelectorAll('.analytics-energy-row');
    expect(rows).toHaveLength(2);
    // Sorted by consumption, so L.O Red (75) leads.
    expect(within(rows[0] as HTMLElement).getByText('L.O Red')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('75%')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('25%')).toBeInTheDocument();
    expect(screen.getByText('100.00 kWh')).toBeInTheDocument();
  });

  it('omits a branch with no energy reading rather than charting it as 0', () => {
    useDeviceStore.setState({
      totals: totals(),
      latestReadings: { mtr_a: reading('mtr_a', 40), mtr_b: reading('mtr_b', undefined) },
    });
    render(<EnergySection branchDevices={BRANCHES} />);
    expect(document.querySelectorAll('.analytics-energy-row')).toHaveLength(1);
    expect(screen.queryByText('L.O Red')).not.toBeInTheDocument();
    // The share is against the branches actually shown, so the one real branch is 100%.
    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});
