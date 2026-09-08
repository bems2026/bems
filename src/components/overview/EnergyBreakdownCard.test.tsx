import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { EnergyBreakdownCard } from './EnergyBreakdownCard';
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

const reading = (id: string, energy: number | undefined, integrated?: number): Reading => ({
  device_id: id,
  ts: new Date().toISOString(),
  online: true,
  state: null,
  ...(energy === undefined ? {} : { energy_kwh_today: energy }),
  ...(integrated === undefined ? {} : { energy_kwh_today_integrated: integrated }),
});

const totals = (over: Partial<Totals> = {}): Totals => ({
  device_id: '_totals',
  ts: new Date().toISOString(),
  // RM-057: the building figure IS the branch sum. The independently-integrated one rides
  // alongside it, and that is what the disagreement check reads.
  energy_kwh_today: 4.746,
  energy_kwh_week: 20.27,
  energy_kwh_month: 61.907,
  energy_kwh_today_integrated: 5.086,
  energy_kwh_week_integrated: 20.552,
  energy_kwh_month_integrated: 61.957,
  total_power_w: 799.5,
  avg_voltage: 229.3,
  phase_current: { red: 5.3, yellow: 4.2, blue: null },
  ...over,
});

/* The four CT meters of this building, with the live figures they served on 2026-09-08 13:32. */
const METERS = [meter('mtr_co_yellow', 'C.O Yellow'), meter('mtr_lo_red', 'L.O Red'), meter('mtr_arec_acu', 'CARE ACU'), meter('mtr_lo_yellow', 'L.O Yellow')];
const LIVE: Record<string, Reading> = {
  mtr_co_yellow: reading('mtr_co_yellow', 1.653),
  mtr_lo_red: reading('mtr_lo_red', 0.139),
  mtr_arec_acu: reading('mtr_arec_acu', 2.652),
  mtr_lo_yellow: reading('mtr_lo_yellow', 0.302),
};

afterEach(() => {
  cleanup();
  useDeviceStore.setState({ devices: [], latestReadings: {}, totals: null, history: {} });
});

describe('EnergyBreakdownCard', () => {
  it('splits today by branch, largest first, as a share of the branches shown', () => {
    useDeviceStore.setState({ devices: METERS, latestReadings: LIVE, totals: totals() });
    render(<EnergyBreakdownCard />);
    const rows = document.querySelectorAll('.breakdown-row');
    expect(rows).toHaveLength(4);
    expect(within(rows[0] as HTMLElement).getByText('CARE ACU')).toBeInTheDocument();
    expect(screen.getByText('4.75')).toBeInTheDocument();
  });

  /*
   * RM-055 relabelled this headline "kWh today · branches" because it was the branch sum
   * standing next to Live Demand's separately-derived building counter. RM-057 made them the
   * same number, so the qualifier now distinguishes nothing and the plain label is correct
   * again. Pinned so the qualifier cannot come back while the derivation stays shared.
   */
  it('names the headline plainly, because it is the building figure now', () => {
    useDeviceStore.setState({ devices: METERS, latestReadings: LIVE, totals: totals() });
    render(<EnergyBreakdownCard />);
    const headline = document.querySelector('.breakdown-total');
    expect(headline).toHaveTextContent('4.75');
    expect(headline).toHaveTextContent(/kWh today/);
    expect(headline).not.toHaveTextContent(/branches/);
  });

  it('stays quiet when the branches sum to less than the building total — the normal direction', () => {
    // The live case: 4.746 against 5.086, the branches 6.7% under.
    useDeviceStore.setState({ devices: METERS, latestReadings: LIVE, totals: totals() });
    render(<EnergyBreakdownCard />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('says so when the branches sum to more than the building total can explain', () => {
    // RM-053's shape, on the day figure: one branch carrying an offset nothing cleared.
    useDeviceStore.setState({
      devices: METERS,
      latestReadings: { ...LIVE, mtr_lo_yellow: reading('mtr_lo_yellow', 77.502) },
      totals: totals(),
    });
    render(<EnergyBreakdownCard />);
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('81.95 kWh');
    expect(notice).toHaveTextContent('5.09 kWh');
  });

  it('has nothing to compare against before the first totals frame, and does not assume', () => {
    useDeviceStore.setState({
      devices: METERS,
      latestReadings: { ...LIVE, mtr_lo_yellow: reading('mtr_lo_yellow', 77.502) },
      totals: null,
    });
    render(<EnergyBreakdownCard />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // The split itself still renders — the comparison is missing, not the data.
    expect(document.querySelectorAll('.breakdown-row')).toHaveLength(4);
  });

  it('has nothing to compare against when the building never counted today', () => {
    useDeviceStore.setState({
      devices: METERS,
      latestReadings: { ...LIVE, mtr_lo_yellow: reading('mtr_lo_yellow', 77.502) },
      totals: totals({ energy_kwh_today_integrated: null }),
    });
    render(<EnergyBreakdownCard />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('stays quiet against a bridge too old to send the independent figure', () => {
    // A deployed bridge predating RM-057 sends no `*_integrated` field at all. Absent is not
    // zero, and inventing a comparison against `undefined` would shout on every frame.
    const older = totals();
    delete older.energy_kwh_today_integrated;
    useDeviceStore.setState({
      devices: METERS,
      latestReadings: { ...LIVE, mtr_lo_yellow: reading('mtr_lo_yellow', 77.502) },
      totals: older,
    });
    render(<EnergyBreakdownCard />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  /*
   * RM-058 — the direction the building-wide check cannot see. `mtr_arec_acu` served 2.652 kWh
   * on 2026-09-08 while the building's integration of that same meter gave 2.993 over the same
   * day: 11.4% at the branch, 6.7% at the building, and only one of those is loud enough to act
   * on.
   */
  it('names a branch reporting less energy than its own meter measured', () => {
    useDeviceStore.setState({
      devices: METERS,
      latestReadings: {
        mtr_co_yellow: reading('mtr_co_yellow', 1.653, 1.656),
        mtr_lo_red: reading('mtr_lo_red', 0.139, 0.138),
        mtr_arec_acu: reading('mtr_arec_acu', 2.652, 2.993),
        mtr_lo_yellow: reading('mtr_lo_yellow', 0.302, 0.301),
      },
      totals: totals({ energy_kwh_today: 4.746, energy_kwh_today_integrated: 5.088 }),
    });
    render(<EnergyBreakdownCard />);
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('CARE ACU');
    expect(notice).toHaveTextContent('2.65 kWh');
    expect(notice).toHaveTextContent('2.99 kWh');
    expect(notice).not.toHaveTextContent('L.O Red');
  });

  it('stays quiet when every branch agrees with its own measurement', () => {
    // The four live branches at 15:35, post-repair, within ±1.4%.
    useDeviceStore.setState({
      devices: METERS,
      latestReadings: {
        mtr_co_yellow: reading('mtr_co_yellow', 2.228, 2.256),
        mtr_lo_red: reading('mtr_lo_red', 0.167, 0.165),
        mtr_arec_acu: reading('mtr_arec_acu', 3.958, 3.908),
        mtr_lo_yellow: reading('mtr_lo_yellow', 0.302, 0.301),
      },
      totals: totals({ energy_kwh_today: 6.655, energy_kwh_today_integrated: 6.63 }),
    });
    render(<EnergyBreakdownCard />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('waits rather than charting an empty split', () => {
    useDeviceStore.setState({ devices: METERS, latestReadings: {}, totals: totals() });
    render(<EnergyBreakdownCard />);
    expect(screen.getByText(/Waiting for branch meter readings/)).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
