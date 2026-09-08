import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import { EnergySection } from './EnergySection';
import {
  energyDisagreement,
  branchShortfalls,
  DISAGREEMENT_MARGIN,
  DISAGREEMENT_FLOOR_KWH,
  BRANCH_SHORTFALL_MARGIN,
  BRANCH_SHORTFALL_FLOOR_KWH,
} from '@/lib/energyDisagreement';
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

/*
 * RM-054 — the two quantities on this card are now compared, not just rendered side by side.
 *
 * Every figure below is measured on this building, not invented: the healthy pairs come from
 * the live bridge and from RM-053's post-repair reading, the fault pair is what the page
 * actually showed during RM-053. See the constants' own docblock in `lib/energyDisagreement.ts`.
 */
describe('energyDisagreement', () => {
  it('says nothing when the branch sum falls short of the building total — the normal direction', () => {
    // Live, 2026-09-08 13:32: the branches read 6.7% BELOW the building's counter for today.
    expect(energyDisagreement(4.746, 5.086)).toBeNull();
    // And a shortfall far bigger than the margin is still not a disagreement worth reporting:
    // the branches are part of the building's load, so under is where they are allowed to be.
    expect(energyDisagreement(1, 100)).toBeNull();
  });

  it('says nothing about the excess two differently-derived counters normally show', () => {
    // RM-053's own independent check, the week immediately after the repair: +0.31%.
    expect(energyDisagreement(18.646, 18.588)).toBeNull();
    // A 20% excess is still inside the margin — six hours of a day in which the building's
    // integrator recorded nothing while the meters' own registers kept counting.
    expect(energyDisagreement(24, 20)).toBeNull();
  });

  it('holds its tongue at the margin and speaks just past it', () => {
    // Sized so the absolute floor is cleared with room to spare and only the ratio decides.
    const total = 40;
    expect(energyDisagreement(total * (1 + DISAGREEMENT_MARGIN), total)).toBeNull();
    expect(energyDisagreement(total * (1 + DISAGREEMENT_MARGIN) + 0.01, total)).not.toBeNull();
  });

  it('stays quiet while both figures are too small for a ratio to mean anything', () => {
    // Minutes after local midnight: 40x the building total, and 0.39 kWh of real disagreement.
    // A ratio alone would shout here every night.
    expect(energyDisagreement(0.4, 0.01)).toBeNull();
    expect(energyDisagreement(DISAGREEMENT_FLOOR_KWH, 0.001)).toBeNull();
    // Same tiny total, an excess that has grown past the floor: now it means something.
    expect(energyDisagreement(DISAGREEMENT_FLOOR_KWH + 0.02, 0.001)).not.toBeNull();
  });

  it('reports the fault it exists for, with both figures and the multiple', () => {
    // What the page rendered without comment during RM-053: four branches summing to 99.546
    // kWh against a building week of 18.4.
    const found = energyDisagreement(99.546, 18.4);
    expect(found).toEqual({ branchSum: 99.546, total: 18.4, excessKwh: expect.closeTo(81.146, 3), ratio: expect.closeTo(5.41, 2) });
  });

  it('has nothing to compare against when the building total is missing, and does not assume', () => {
    // The tiles already render this as "No data". An absent counter is not a zero one, so it
    // cannot stand in as the smaller side of a comparison.
    expect(energyDisagreement(99.546, null)).toBeNull();
    expect(energyDisagreement(99.546, undefined)).toBeNull();
  });

  it('still reports a building total of exactly zero, but claims no multiple of it', () => {
    // A real 0.00 against branches carrying a whole week is a contradiction, not a quiet
    // period — but "Infinity times" is not a thing to render.
    expect(energyDisagreement(20, 0)).toEqual({ branchSum: 20, total: 0, excessKwh: 20, ratio: null });
  });
});

describe('EnergySection — branch/total disagreement', () => {
  /*
   * RM-057 changed what this compares. The tiles now show the SUM of the branches, so comparing
   * the split against them would compare a number with itself. The independent figure is
   * `*_integrated` — the legacy flow's two-second integration of the same circuits.
   */
  const disagreeing = () =>
    useDeviceStore.setState({
      totals: totals({
        energy_kwh_today: 4.7,
        energy_kwh_week: 99.546,
        energy_kwh_today_integrated: 5.086,
        energy_kwh_week_integrated: 18.4,
      }),
      latestReadings: {
        mtr_a: reading('mtr_a', 3.1, { energy_kwh_week: 79.278 }),
        mtr_b: reading('mtr_b', 1.6, { energy_kwh_week: 20.268 }),
      },
    });

  it('names both figures on the page instead of rendering the contradiction silently', () => {
    disagreeing();
    render(<EnergySection branchDevices={BRANCHES} />);
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));

    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('99.55 kWh');
    expect(notice).toHaveTextContent('18.40 kWh');
    expect(notice).toHaveTextContent('5.4');
    // The rows are still drawn — this says the two disagree, it does not decide which is right.
    expect(document.querySelectorAll('.analytics-energy-row')).toHaveLength(2);
  });

  /*
   * Deliberately the mirror of the test above: here the DAY is the one out of step and the
   * week is fine, so a check wired to the wrong period's counter goes quiet where it should
   * speak and speaks where it should stay quiet. Reading today's split against the week's
   * total, or vice versa, fails this in one direction or the other.
   */
  it('reads each period against its own total, not one period against another', () => {
    useDeviceStore.setState({
      // A fresh week, so the day IS the week — but the integrator counted 5.086 for the day.
      totals: totals({
        energy_kwh_today: 20,
        energy_kwh_week: 20,
        energy_kwh_today_integrated: 5.086,
        energy_kwh_week_integrated: 18.4,
      }),
      latestReadings: {
        mtr_a: reading('mtr_a', 15, { energy_kwh_week: 15 }),
        mtr_b: reading('mtr_b', 5, { energy_kwh_week: 5 }),
      },
    });
    render(<EnergySection branchDevices={BRANCHES} />);
    // Today: 20.00 against 5.09 — 3.9x, and it says so.
    expect(screen.getByRole('status')).toHaveTextContent('5.09 kWh');

    // The same 20.00 against the week's own 18.40 is +8.7%, inside what two derivations do.
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('stays quiet when the branches sum to less than the building total', () => {
    useDeviceStore.setState({
      totals: totals({ energy_kwh_today: 4.746, energy_kwh_today_integrated: 5.086 }),
      latestReadings: { mtr_a: reading('mtr_a', 1.652), mtr_b: reading('mtr_b', 3.094) },
    });
    render(<EnergySection branchDevices={BRANCHES} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  /*
   * RM-058 on the page. The fixture is the live fault: `mtr_arec_acu` served 2.652 kWh while the
   * building's own integration of that same meter gave 2.993 over the same day.
   */
  it('names a branch that is reporting less energy than its own meter measured', () => {
    useDeviceStore.setState({
      totals: totals({ energy_kwh_today: 4.305, energy_kwh_today_integrated: 4.649 }),
      latestReadings: {
        mtr_a: reading('mtr_a', 2.652, { energy_kwh_today_integrated: 2.993 }),
        mtr_b: reading('mtr_b', 1.653, { energy_kwh_today_integrated: 1.656 }),
      },
    });
    render(<EnergySection branchDevices={BRANCHES} />);
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('C.O Yellow');
    expect(notice).toHaveTextContent('2.65 kWh');
    expect(notice).toHaveTextContent('2.99 kWh');
    // The healthy branch is not named — 1.653 against 1.656 is 0.2%.
    expect(notice).not.toHaveTextContent('L.O Red');
  });

  it('offers no per-branch verdict for week or month, because there is nothing to compare', () => {
    // The legacy engine keeps a per-meter DAILY figure and no per-meter week or month, so a
    // longer period has no second opinion. Silence is the honest answer, not a check that
    // quietly compares today's integration against a week of register.
    useDeviceStore.setState({
      totals: totals({ energy_kwh_today: 4.305, energy_kwh_today_integrated: 4.649 }),
      latestReadings: {
        mtr_a: reading('mtr_a', 2.652, { energy_kwh_week: 20, energy_kwh_today_integrated: 2.993 }),
        mtr_b: reading('mtr_b', 1.653, { energy_kwh_week: 10, energy_kwh_today_integrated: 1.656 }),
      },
    });
    render(<EnergySection branchDevices={BRANCHES} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('stays quiet when every branch agrees with its own measurement', () => {
    // The four live branches at 15:35, post-repair, within ±1.4%.
    useDeviceStore.setState({
      totals: totals({ energy_kwh_today: 2.395, energy_kwh_today_integrated: 2.421 }),
      latestReadings: {
        mtr_a: reading('mtr_a', 2.228, { energy_kwh_today_integrated: 2.256 }),
        mtr_b: reading('mtr_b', 0.167, { energy_kwh_today_integrated: 0.165 }),
      },
    });
    render(<EnergySection branchDevices={BRANCHES} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('stays quiet when the bridge sends no per-branch second opinion at all', () => {
    // Older bridge, or an outlet: the field is absent and absent is not zero.
    useDeviceStore.setState({
      totals: totals({ energy_kwh_today: 4.305, energy_kwh_today_integrated: 4.649 }),
      latestReadings: { mtr_a: reading('mtr_a', 2.652), mtr_b: reading('mtr_b', 1.653) },
    });
    render(<EnergySection branchDevices={BRANCHES} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('stays quiet when the building never counted the period it would compare against', () => {
    useDeviceStore.setState({
      totals: totals({ energy_kwh_week: null, energy_kwh_week_integrated: null }),
      latestReadings: {
        mtr_a: reading('mtr_a', 3.1, { energy_kwh_week: 79.278 }),
        mtr_b: reading('mtr_b', 1.6, { energy_kwh_week: 20.268 }),
      },
    });
    render(<EnergySection branchDevices={BRANCHES} />);
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    // The tile for that period says so, and the split says nothing at all.
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

/*
 * RM-058 — the direction RM-057 made meaningful, checked where it is loudest.
 *
 * Every figure is measured on this building. The healthy row is the four branches against their
 * own two-second integration at 15:35 on 2026-09-08, after RM-056's fix and RM-056b's repair;
 * the fault row is `mtr_arec_acu` earlier the same day, while the day-baseline tracker was still
 * absorbing its consumption.
 */
describe('branchShortfalls', () => {
  const br = (id: string, name: string, kwh: number, integrated?: number) => ({ id, name, kwh, integrated });

  it('says nothing about the four branches as they actually read', () => {
    // Live at 15:35, post-repair: -1.26%, +1.36%, +1.28%, +0.29%.
    expect(
      branchShortfalls([
        br('mtr_co_yellow', 'C.O Yellow', 2.228, 2.256),
        br('mtr_lo_red', 'L.O Red', 0.167, 0.165),
        br('mtr_arec_acu', 'CARE ACU', 3.958, 3.908),
        br('mtr_lo_yellow', 'L.O Yellow', 0.302, 0.301),
      ]),
    ).toEqual([]);
  });

  it('names the branch that RM-056 was quietly emptying', () => {
    // 2026-09-08 13:32: the register-derived figure was 2.652 while the meter own power
    // integrated to 2.993 over the same day. The building-level shortfall was 6.7% and went
    // unnoticed; at the branch it is 11.4%.
    const found = branchShortfalls([
      br('mtr_arec_acu', 'CARE ACU', 2.652, 2.993),
      br('mtr_co_yellow', 'C.O Yellow', 1.653, 1.656),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe('mtr_arec_acu');
    expect(found[0].name).toBe('CARE ACU');
    expect(found[0].missingKwh).toBeCloseTo(0.341, 3);
    expect(found[0].fraction).toBeCloseTo(0.1139, 3);
  });

  it('ignores a branch reading ABOVE its integration — that is the other direction', () => {
    // The integrator accrues only while the meter reads healthy and while Node-RED runs, so a
    // branch ahead of it is expected. `energyDisagreement` is what watches that side.
    expect(branchShortfalls([br('mtr_a', 'A', 12, 8)])).toEqual([]);
  });

  it('stays quiet while the absolute gap is too small to mean anything', () => {
    // Minutes after midnight, and after any register lump: the register trails the integration
    // by up to one lump (~0.015 kWh on the busiest branch here). A ratio alone would flag every
    // branch every night.
    expect(branchShortfalls([br('mtr_a', 'A', 0.02, 0.05)])).toEqual([]);
    // Either side of the floor, expressed as a fraction of it rather than by subtracting it —
    // `1 - 0.15` is 0.85 and `1 - 0.85` is 0.15000000000000002, so an exact-boundary assertion
    // would be testing IEEE-754 rather than the rule.
    expect(branchShortfalls([br('mtr_a', 'A', 1 - BRANCH_SHORTFALL_FLOOR_KWH * 0.99, 1)])).toEqual([]);
    expect(branchShortfalls([br('mtr_a', 'A', 1 - BRANCH_SHORTFALL_FLOOR_KWH * 1.05, 1)])).toHaveLength(1);
  });

  it('stays quiet while the proportion is small, however many kWh that is', () => {
    // 2 kWh short of 102 is 1.96%: a big branch on a long day, well inside what two derivations
    // of the same circuit do. The absolute bar alone would flag it.
    expect(branchShortfalls([br('mtr_a', 'A', 100, 102)])).toEqual([]);
  });

  it('holds its tongue at the margin and speaks just past it', () => {
    const integrated = 10; // so the floor is cleared with room and only the ratio decides
    expect(branchShortfalls([br('mtr_a', 'A', integrated * (1 - BRANCH_SHORTFALL_MARGIN), integrated)])).toEqual([]);
    expect(branchShortfalls([br('mtr_a', 'A', integrated * (1 - BRANCH_SHORTFALL_MARGIN) - 0.01, integrated)])).toHaveLength(1);
  });

  it('skips a branch with no second opinion rather than assuming one', () => {
    // An outlet has no cumulative register, so the bridge sends no integrated figure for it
    // (RM-058), and a bridge older than that sends none at all. Absent is not zero.
    expect(branchShortfalls([br('co1', 'Outlet 1', 5, undefined)])).toEqual([]);
    expect(branchShortfalls([br('mtr_a', 'A', 5)])).toEqual([]);
  });

  it('reports the worst first, because that is the one to look at', () => {
    const found = branchShortfalls([
      br('mtr_a', 'A', 8, 10),
      br('mtr_b', 'B', 2, 10),
      br('mtr_c', 'C', 9.9, 10),
    ]);
    expect(found.map((f) => f.id)).toEqual(['mtr_b', 'mtr_a']);
  });

  it('refuses a period other than today, because there is no second opinion for one', () => {
    // The legacy engine keeps a per-meter DAILY figure and no per-meter week or month. A week's
    // register compared against today's integration would be two different questions, and this
    // case is the only way that mistake is observable: a week register is always at least
    // today's, so the comparison could never report a shortfall of its own accord.
    const short = [{ id: 'mtr_a', name: 'A', kwh: 1, integrated: 5 }];
    expect(branchShortfalls(short, 'today')).toHaveLength(1);
    expect(branchShortfalls(short, 'week')).toEqual([]);
    expect(branchShortfalls(short, 'month')).toEqual([]);
  });

  it('treats an integrated figure of zero as nothing to compare against', () => {
    // A branch whose integration has not accrued yet cannot be short of it, and dividing by it
    // would yield Infinity for a fraction the page would then try to render.
    expect(branchShortfalls([br('mtr_a', 'A', 0, 0)])).toEqual([]);
    expect(branchShortfalls([br('mtr_a', 'A', -1, 0)])).toEqual([]);
  });
});
