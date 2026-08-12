import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
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

const reading = (id: string, energy: number | undefined, over: Partial<Reading> = {}): Reading => ({
  device_id: id,
  ts: new Date().toISOString(),
  online: true,
  state: null,
  ...(energy === undefined ? {} : { energy_kwh_today: energy }),
  ...over,
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

  it('switches the split to the accumulated week and month figures', () => {
    useDeviceStore.setState({
      totals: totals(),
      latestReadings: {
        mtr_a: reading('mtr_a', 10, { energy_kwh_week: 70, energy_kwh_month: 300 }),
        mtr_b: reading('mtr_b', 30, { energy_kwh_week: 210, energy_kwh_month: 900 }),
      },
    });
    render(<EnergySection branchDevices={BRANCHES} />);
    expect(screen.getByText('40.00 kWh')).toBeInTheDocument(); // today's branch sum

    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(screen.getByText('280.00 kWh')).toBeInTheDocument();
    expect(screen.getByText('70.00')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    expect(screen.getByText('1200.00 kWh')).toBeInTheDocument();
    expect(screen.getByText('900.00')).toBeInTheDocument();
  });

  /*
   * A bridge that hasn't yet seen a full day roll over has no week/month accumulator, so
   * those readings are absent. That must read as "not counted yet" — inferring a week from
   * a single day, or showing 0, would both be inventions.
   */
  it('says week/month are not counted yet when the accumulator has no data', () => {
    useDeviceStore.setState({
      totals: totals(),
      latestReadings: { mtr_a: reading('mtr_a', 10), mtr_b: reading('mtr_b', 30) },
    });
    render(<EnergySection branchDevices={BRANCHES} />);
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(screen.getByText(/Not counted yet/)).toBeInTheDocument();
    expect(screen.queryByText('0.00 kWh')).not.toBeInTheDocument();
    expect(document.querySelectorAll('.analytics-energy-row')).toHaveLength(0);
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
