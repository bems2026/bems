import { describe, it, expect } from 'vitest';
import { conservedBuilding, conservedDaily, counterNote, differingDays } from './periodEnergy';
import type { PeriodBuildingReport, PeriodDeviceReport } from './supabaseReports';
import type { DailyRow } from './reportSeries';
import type { DeviceDayRow } from './circuitSeries';

/**
 * RM-154 — one energy figure per period.
 *
 * The Overview printed the building's month counter and the Circuits tab the sum of the branch circuits:
 * the same four meters, reduced two ways. On 23 Sep 2026 the counter read 17.26 kWh, the circuits 19.59
 * and the meters' average power over the day 21.00; the counter's week of 21 Sep (80.53) was not even
 * the sum of its own days (75.17), while the circuits' week (77.88) was exactly theirs (E-233). So the
 * circuits' sum is the figure, everywhere, and the counter is kept beside it as a stated check.
 */

const METERS = ['m_a', 'm_b', 'm_c'];
const FULL = 7 * 1440;
const building = (o: Partial<PeriodBuildingReport> = {}): PeriodBuildingReport => ({
  period: 'week',
  period_start: '2026-09-21',
  energy_kwh: 80.53,
  peak_total_power_w: 4000,
  avg_voltage: 220,
  phase_current_red_avg: 2,
  phase_current_yellow_avg: 2,
  phase_current_blue_avg: null,
  command_count: 0,
  command_count_manual: 0,
  command_count_schedule: 0,
  command_count_autoshed: 0,
  anomaly_count: 0,
  online_sample_count: FULL,
  expected_sample_count: FULL,
  generated_at: '2026-09-29T00:00:00Z',
  ...o,
});
const meter = (device_id: string, energy_kwh: number | null, o: Partial<PeriodDeviceReport> = {}): PeriodDeviceReport => ({
  period: 'week',
  period_start: '2026-09-21',
  device_id,
  energy_kwh,
  peak_power_w: 3000,
  avg_power_w: 200,
  online_sample_count: FULL,
  expected_sample_count: FULL,
  ...o,
});
const ROWS = [meter('m_a', 20), meter('m_b', 50.5), meter('m_c', 7.38), meter('outlet', 3)];

describe('conservedBuilding', () => {
  it('states the period as the sum of its circuits, and keeps the counter beside it', () => {
    const b = conservedBuilding(building(), ROWS, METERS);
    expect(b.energy_kwh).toBeCloseTo(77.88, 6);
    expect(b.counter_kwh).toBe(80.53);
    expect(b.energy_source).toBe('circuits');
    expect(b.uncounted).toEqual([]);
  });

  it('a device inside a circuit is never added on top of its circuit', () => {
    // `outlet` sits under one of the branch meters; counting it would count its energy twice.
    expect(conservedBuilding(building(), ROWS, METERS).energy_kwh).toBeCloseTo(77.88, 6);
  });

  it('a circuit whose figure is impossible is named, and the total says it is at least this much', () => {
    // 900 kWh in a week from a circuit that never drew more than 300 W cannot have happened.
    const rows = [meter('m_a', 20), meter('m_b', 900, { peak_power_w: 300 }), meter('m_c', 7.38)];
    const b = conservedBuilding(building(), rows, METERS);
    expect(b.uncounted).toEqual(['m_b']);
    expect(b.energy_kwh).toBeCloseTo(27.38, 6);
  });

  it('keeps the counter when a circuit has no row at all, or the rows have not arrived', () => {
    expect(conservedBuilding(building(), [meter('m_a', 20)], METERS)).toMatchObject({ energy_kwh: 80.53, energy_source: 'counter' });
    expect(conservedBuilding(building(), null, METERS)).toMatchObject({ energy_kwh: 80.53, energy_source: 'counter' });
  });
});

const day = (local_day: string, energy_kwh: number): DailyRow => ({
  local_day,
  energy_kwh,
  peak_power_w: 2000,
  avg_power_w: 600,
  sample_count: 1440,
  usable_sample_count: 1440,
  expected_samples: 1440,
  first_seen_minute: 0,
  last_seen_minute: 1439,
  resolution: 'minute',
});
const dev = (device_id: string, local_day: string, energy_kwh: number | null): DeviceDayRow => ({
  device_id,
  local_day,
  energy_kwh,
  counter_kwh: energy_kwh,
  removed_kwh: null,
  clipped_hours: 0,
  peak_power_w: 1000,
  avg_power_w: 300,
  online_minutes: 1440,
  expected_minutes: 1440,
  resolution: 'minute',
});

describe('conservedDaily', () => {
  const daily = [day('2026-09-22', 15.49), day('2026-09-23', 17.26), day('2026-09-24', 15.3)];
  const devices = [
    ...['m_a', 'm_b', 'm_c'].map((m, i) => dev(m, '2026-09-22', [5, 10, 0.49][i])),
    ...['m_a', 'm_b', 'm_c'].map((m, i) => dev(m, '2026-09-23', [7.72, 11.21, 0.66][i])),
    dev('m_a', '2026-09-24', 5),
    dev('outlet', '2026-09-23', 99),
  ];

  it('gives each day the sum of its circuits, so the bars add up to the period', () => {
    const out = conservedDaily(daily, devices, METERS);
    expect(out[0].energy_kwh).toBeCloseTo(15.49, 6);
    expect(out[1].energy_kwh).toBeCloseTo(19.59, 6);
    // Everything else about the day — its coverage, its peak — is the building series' own.
    expect(out[1].usable_sample_count).toBe(1440);
  });

  it('keeps the counter for a day a circuit did not report, and changes nothing before the circuits arrive', () => {
    expect(conservedDaily(daily, devices, METERS)[2].energy_kwh).toBe(15.3);
    expect(conservedDaily(daily, null, METERS)).toBe(daily);
  });

  it('names the days the two readings part, to the twentieth of a kilowatt-hour', () => {
    expect(differingDays(daily, conservedDaily(daily, devices, METERS))).toEqual(['2026-09-23']);
  });
});

describe('counterNote', () => {
  it('says nothing when the counter and the circuits agree', () => {
    expect(counterNote({ ...conservedBuilding(building({ energy_kwh: 77.9 }), ROWS, METERS) }, [])).toBeNull();
  });

  it('states the counter, by how much and which way, and the days they part', () => {
    const note = counterNote(conservedBuilding(building(), ROWS, METERS), ['2026-09-21', '2026-09-23']);
    expect(note).toMatch(/^The building's own counter read 80\.53 kWh, 2\.65 more than its circuits\./);
    expect(note).toMatch(/on 21 and 23 Sep/);
  });

  it('says nothing when the counter is the figure shown — there is nothing to set it against', () => {
    expect(counterNote(conservedBuilding(building(), null, METERS), [])).toBeNull();
  });
});
