import { describe, it, expect } from 'vitest';
import {
  bankDay,
  boundDay,
  energyFlagOf,
  energyFlagText,
  hourRegister,
  periodEnergyCheck,
  registerGain,
  rolledHourRegister,
  usableEnergy,
  type HourAgg,
} from './boundedEnergy';
import type { PeriodDeviceReport } from './supabaseReports';

/**
 * RM-090 — a meter's counter may not add more energy than the circuit could have drawn.
 *
 * The live case: on 2026-09-08 a lighting circuit's register jumped 0.111 -> 67.391 kWh at 02:36
 * while it drew 49 W, and the weekly report summed that day's high-water mark into 81.406 kWh for a
 * circuit whose highest draw all week was 251 W. These fixtures are the same six days
 * `supabase/rehearse.sh` seeds for phase42, with the same expected numbers — the rule exists twice,
 * in SQL and here, and the two are held to one answer.
 */

const HOUR = 3_600_000;
/** Local midnight of the fixture day, as an instant. Any instant works; the rule only uses offsets. */
const DAY = Date.UTC(2026, 5, 14, 16);

const h = (hour: number, energyMaxKwh: number | null, powerAvgW: number | null, powerMaxW: number | null): HourAgg => ({
  hourStartMs: DAY + hour * HOUR,
  energyMaxKwh,
  powerAvgW,
  powerMaxW,
});

describe('boundDay — one local day, rise by rise', () => {
  it('A: credits the measured power for an hour whose counter jumped, and keeps the real rises either side', () => {
    const day = boundDay([h(0, 0.1, 50, 60), h(1, 0.15, 50, 60), h(2, 67.4, 50, 60), h(3, 67.45, 50, 60), h(4, 0.3, 50, 60), h(5, 0.35, 50, 60)], DAY);
    expect(day.energyKwh).toBeCloseTo(0.3, 9);
    expect(day.counterKwh).toBeCloseTo(67.45, 9);
    expect(day.removedKwh).toBeCloseTo(67.15, 9);
    expect(day.clipped.map((c) => c.hourStartMs)).toEqual([DAY + 2 * HOUR]);
  });

  it('B: leaves a healthy day exactly as its counter says', () => {
    const day = boundDay([h(8, 0.2, 300, 400), h(9, 0.5, 300, 400), h(10, 0.9, 300, 400)], DAY);
    expect(day.energyKwh).toBeCloseTo(0.9, 9);
    expect(day.counterKwh).toBeCloseTo(0.9, 9);
    expect(day.removedKwh).toBeNull();
    expect(day.clipped).toEqual([]);
  });

  it('D: allows a nine-hour offline gap the energy the circuit could draw across it', () => {
    // The device kept counting while nobody could read it; the rise after the gap is real.
    const day = boundDay([h(1, 0.2, 100, 100), h(10, 1.0, 100, 100)], DAY);
    expect(day.energyKwh).toBeCloseTo(1.0, 9);
    expect(day.removedKwh).toBeNull();
  });

  it('C: counts both runs of a counter that restarted mid-day', () => {
    const day = boundDay([h(8, 1.0, 400, 500), h(9, 1.4, 400, 500), h(10, 0.1, 400, 500), h(11, 0.5, 400, 500)], DAY);
    expect(day.energyKwh).toBeCloseTo(1.8, 9);
    expect(day.counterKwh).toBeCloseTo(1.4, 9);
    expect(day.removedKwh).toBeNull();
  });

  it('F: credits nothing for a jump in an hour that carried no power reading', () => {
    const day = boundDay([h(0, 0.1, 80, 90), h(1, 30.0, null, null)], DAY);
    expect(day.energyKwh).toBeCloseTo(0.1, 9);
    expect(day.counterKwh).toBeCloseTo(30, 9);
    expect(day.removedKwh).toBeCloseTo(29.9, 9);
  });

  it('judges nothing when the day carried no power reading at all', () => {
    const day = boundDay([h(0, 0.1, null, null), h(1, 30.0, null, null)], DAY);
    expect(day.energyKwh).toBeCloseTo(30, 9);
    expect(day.removedKwh).toBeNull();
  });

  it('says nothing about a day with no counter — null, never 0', () => {
    expect(boundDay([h(0, null, 50, 60)], DAY)).toEqual({ energyKwh: null, counterKwh: null, removedKwh: null, clipped: [] });
    expect(boundDay([], DAY).energyKwh).toBeNull();
  });

  it('reads hours in time order whatever order they arrive in', () => {
    const day = boundDay([h(9, 0.5, 300, 400), h(8, 0.2, 300, 400), h(10, 0.9, 300, 400)], DAY);
    expect(day.energyKwh).toBeCloseTo(0.9, 9);
    expect(day.removedKwh).toBeNull();
  });
});

const row = (o: Partial<PeriodDeviceReport> = {}): PeriodDeviceReport => ({
  period: 'week',
  period_start: '2026-09-07',
  device_id: 'dev',
  energy_kwh: 24.188,
  peak_power_w: 673.6,
  avg_power_w: 143.8,
  online_sample_count: 10057,
  expected_sample_count: 10080,
  ...o,
});

describe('periodEnergyCheck — a stored period figure against what the circuit could draw', () => {
  it('calls the live 81.406 kWh at a 251.2 W peak impossible: 251.2 W for all 168 hours is 42.2 kWh', () => {
    expect(periodEnergyCheck(row({ energy_kwh: 81.406, peak_power_w: 251.2 }))).toBe('impossible');
  });

  it('passes a figure the circuit could have drawn', () => {
    expect(periodEnergyCheck(row())).toBe('ok');
    // The corrected figure for the same circuit and week.
    expect(periodEnergyCheck(row({ energy_kwh: 4.617, peak_power_w: 251.2 }))).toBe('ok');
  });

  it('does not judge what it has nothing to judge against', () => {
    expect(periodEnergyCheck(row({ energy_kwh: null }))).toBe('unjudged');
    expect(periodEnergyCheck(row({ peak_power_w: null }))).toBe('unjudged');
    expect(periodEnergyCheck(row({ peak_power_w: 0 }))).toBe('unjudged');
    expect(periodEnergyCheck(row({ expected_sample_count: 0 }))).toBe('unjudged');
  });
});

describe('energyFlagOf and usableEnergy', () => {
  it('flags an impossible figure and keeps it out of every sum', () => {
    const bad = row({ energy_kwh: 81.406, peak_power_w: 251.2 });
    expect(energyFlagOf(bad)).toEqual({ kind: 'impossible' });
    expect(usableEnergy(bad)).toBeNull();
  });

  it('marks a corrected figure with what was removed, and keeps the figure', () => {
    const fixed = row({ energy_kwh: 4.617, peak_power_w: 251.2, energy_removed_kwh: 76.789, energy_restated_at: '2026-09-17T01:00:00Z' });
    expect(energyFlagOf(fixed)).toEqual({ kind: 'corrected', removedKwh: 76.789, restatedAt: '2026-09-17T01:00:00Z' });
    expect(usableEnergy(fixed)).toBe(4.617);
  });

  it('ignores a removal too small to mention, and a row from before the columns existed', () => {
    expect(energyFlagOf(row({ energy_removed_kwh: 0.0004 }))).toBeNull();
    expect(energyFlagOf(row())).toBeNull();
    expect(usableEnergy(row())).toBe(24.188);
  });

  it('marks a figure phase53 restated with what it was, and keeps the new figure', () => {
    const restated = row({ energy_kwh: 13.908, energy_kwh_before: 11.213, energy_restated_at: '2026-10-02T01:00:00Z' });
    expect(energyFlagOf(restated)).toEqual({ kind: 'restated', beforeKwh: 11.213, restatedAt: '2026-10-02T01:00:00Z' });
    expect(energyFlagText(energyFlagOf(restated)!)).toBe('Restated: was 11.21 kWh — energy used after the meter’s counter reset is now counted');
    expect(usableEnergy(restated)).toBe(13.908);
    expect(energyFlagOf(row({ energy_kwh: 24.188, energy_kwh_before: 24.1884 }))).toBeNull();
  });

  it('says a jump was removed before it says a figure was restated', () => {
    const both = row({ energy_kwh: 4.9, energy_removed_kwh: 5.03, energy_kwh_before: 4.6 });
    expect(energyFlagOf(both)?.kind).toBe('corrected');
  });
});

/**
 * RM-155 — the register banked across a fall, as `supabase/phase53_banked_register.sql` does it. The
 * hours are phase53's rehearsal fixtures, with the same answers.
 */
describe('bankDay — the register banked across a fall', () => {
  const minutes = (n: number, at: (i: number) => number) => Array.from({ length: n }, (_, i) => at(i));
  const hours = (values: number[], firstHour: number) =>
    [0, 1, 2].map((k) => hourRegister(DAY + (firstHour + k) * HOUR, values.slice(k * 60, k * 60 + 60))!);
  const banked = (m: Map<number, number>) => [...m.values()].map((v) => Number(v.toFixed(2)));

  it('H: counts both runs of a register that restarted at 11:30, less the minute the fall took', () => {
    const day = hours(minutes(180, (i) => (i < 90 ? 2 + i * 0.01 : (i - 90) * 0.01)), 10);
    expect(banked(bankDay(day))).toEqual([2.59, 3.18, 3.78]);
  });

  it('I: changes nothing about the daily rollover a minute early', () => {
    const values = minutes(120, (i) => (i < 119 ? 5 + i * 0.01 : 0));
    const day = [0, 1].map((k) => hourRegister(DAY + (22 + k) * HOUR, values.slice(k * 60, k * 60 + 60))!);
    expect(banked(bankDay(day))).toEqual([5.59, 6.18]);
  });

  it('banks a register that never fell to exactly its highest reading each hour', () => {
    const day = hours(minutes(180, (i) => 0.4 + i * 0.002), 7);
    const max = [0, 1, 2].map((k) => 0.4 + (k * 60 + 59) * 0.002);
    [...bankDay(day).values()].forEach((v, k) => expect(v).toBeCloseTo(max[k], 9));
  });

  it('reads an hour rolled up before phase53 as its highest reading — phase42’s rule, exactly', () => {
    const rolled = (hour: number, max: number) => rolledHourRegister(DAY + hour * HOUR, { energy_kwh_today_max: max })!;
    // Fixture C: 1.0, 1.4, a restart to 0.1, then 0.5. Both runs count: 1.8.
    expect(banked(bankDay([rolled(8, 1.0), rolled(9, 1.4), rolled(10, 0.1), rolled(11, 0.5)]))).toEqual([1.0, 1.4, 1.4, 1.8]);
    expect(rolledHourRegister(DAY, { energy_kwh_today_max: null })).toBeNull();
  });

  it('J: carries the bank through hours the rollup kept as first, last and gain', () => {
    // A restart at 08:30 inside an hour since rolled up; 09:00 and 10:00 still minutes.
    const values = minutes(180, (i) => (i < 30 ? 1 + i * 0.01 : (i - 30) * 0.01));
    const rolled = rolledHourRegister(DAY + 8 * HOUR, { energy_kwh_today_max: 1.29, energy_kwh_today_first: 1, energy_kwh_today_last: 0.29, energy_kwh_gain: 0.58 })!;
    const raw = [1, 2].map((k) => hourRegister(DAY + (8 + k) * HOUR, values.slice(k * 60, k * 60 + 60))!);
    expect(banked(bankDay([...raw, rolled]))).toEqual([1.58, 2.18, 2.78]);
  });

  it('registerGain: a fall adds nothing, and the rise after it counts', () => {
    expect(registerGain([1, 2, 0.5, 1])).toBe(1.5);
    expect(registerGain([3])).toBe(0);
    expect(hourRegister(DAY, [])).toBeNull();
  });
});
