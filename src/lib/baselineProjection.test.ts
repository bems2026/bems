import { describe, it, expect } from 'vitest';
import { donorFor, projectPeriod, type BaselineDays } from './baselineProjection';
import { periodDates, type ProjectedBaseline } from './baselineCompare';
import { usableEnergy } from './boundedEnergy';
import { coverageOf } from './supabaseReports';

/**
 * RM-154 — a baseline period built from the recorded days, in the same shapes as a stored report, so it
 * reads through the same tabs and charts.
 *
 * The rules a reader relies on without seeing them: a date is always given the same recorded day, however
 * it is read; a week holds five different working days; every figure adds up — circuits to the building,
 * days to the period — as the recorded reports now do (RM-154's energy rule).
 */

const flat = (w: number) => Array.from({ length: 24 }, () => w);
const day = (date: string, weekday: number, w: number) => ({
  date,
  weekday,
  meters: {
    m_light: { w: flat(w / 10), max: flat(w / 5), a: flat(w / 10 / 230) },
    m_ac: { w: flat(w), max: flat(w * 2), a: flat(w / 230) },
  },
  v: flat(230),
  max_w: flat(w * 2.5),
  filled: [],
});
// Six working days of distinct size, so a repeat would show; two Saturdays, two Sundays.
const DAYS: BaselineDays = {
  version: 1,
  site_id: 'test-lab',
  generated_at: '2026-10-01T00:00:00Z',
  meters: ['m_light', 'm_ac'],
  types: {
    working: { label: 'Working day', scale: 0.97, days: [100, 200, 300, 400, 500, 600].map((w, i) => day(`2026-08-${String(25 + i).padStart(2, '0')}`, 2, w)) },
    saturday: { label: 'Saturday', scale: 1, days: [day('2026-08-29', 6, 40), day('2026-09-05', 6, 60)] },
    sunday: { label: 'Sunday', scale: 1, days: [day('2026-08-30', 0, 10), day('2026-09-06', 0, 12)] },
  },
};
const B = {
  site_id: 'test-lab',
  generated_at: '2026-10-01T00:00:00Z',
  window: { from: '2026-08-25', to: '2026-09-22', days: 29 },
  working_hours: { start: '08:00', end: '17:00' },
  loads: ['lighting', 'aircon'],
  meters: { lighting: ['m_light'], aircon: ['m_ac'] },
  day_types: {
    working: { label: 'Working day', kwh: { total: 8.4 } },
    saturday: { label: 'Saturday', kwh: { total: 1.1 } },
    sunday: { label: 'Sunday', kwh: { total: 0.3 } },
  },
  week: { days: ['sunday', 'working', 'working', 'working', 'working', 'working', 'saturday'], kwh: { total: 0 } },
} as unknown as ProjectedBaseline;

const kwhOf = (w: number) => ((w + w / 10) * 24) / 1000;

describe('donorFor', () => {
  it('gives a date the same recorded day every time, and a day of its own kind', () => {
    const a = donorFor(B, DAYS, '2026-10-07', []);
    expect(donorFor(B, DAYS, '2026-10-07', [])).toEqual(a);
    expect(a.type).toBe('working');
    expect(DAYS.types.working.days).toContainEqual(a.donor);
    expect(donorFor(B, DAYS, '2026-10-10', []).type).toBe('saturday');
    expect(donorFor(B, DAYS, '2026-10-11', []).type).toBe('sunday');
  });

  it('models Friday on the working days, as the operator ruled', () => {
    expect(donorFor(B, DAYS, '2026-10-09', []).type).toBe('working');
  });

  it('turns a holiday into a closed day when asked — the comparison does, the baseline itself does not', () => {
    const holiday = [{ date: '2026-10-05', name: 'A test holiday' }];
    expect(donorFor(B, DAYS, '2026-10-05', []).type).toBe('working');
    const d = donorFor(B, DAYS, '2026-10-05', holiday);
    expect(d.type).toBe('sunday');
    expect(d.holiday).toBe('A test holiday');
  });
});

describe('projectPeriod', () => {
  it('holds five different working days in a week, so no two weekdays are the same day', () => {
    const p = projectPeriod(B, DAYS, 'week', '2026-10-05', {});
    const working = p.days.filter((d) => d.type === 'working').map((d) => d.donor.date);
    expect(working).toHaveLength(5);
    expect(new Set(working).size).toBe(5);
    expect(new Set(p.daily.map((d) => d.energy_kwh)).size).toBeGreaterThan(3);
  });

  it('uses every working day across a month, each about as often as the others', () => {
    const p = projectPeriod(B, DAYS, 'month', '2026-10-01', {});
    const counts = new Map<string, number>();
    for (const d of p.days.filter((x) => x.type === 'working')) counts.set(d.donor.date, (counts.get(d.donor.date) ?? 0) + 1);
    expect(counts.size).toBe(6);
    expect(Math.max(...counts.values()) - Math.min(...counts.values())).toBeLessThanOrEqual(1);
    expect(p.daily).toHaveLength(31);
  });

  it('reads a date the same as a day, in its week and in its month', () => {
    const date = '2026-10-14';
    const alone = projectPeriod(B, DAYS, 'day', date, {}).building.energy_kwh;
    const inWeek = projectPeriod(B, DAYS, 'week', '2026-10-12', {}).daily.find((d) => d.local_day === date)?.energy_kwh;
    const inMonth = projectPeriod(B, DAYS, 'month', '2026-10-01', {}).daily.find((d) => d.local_day === date)?.energy_kwh;
    expect(inWeek).toBeCloseTo(alone as number, 9);
    expect(inMonth).toBeCloseTo(alone as number, 9);
  });

  it('adds up: circuits to the building, days to the period, hours to the day', () => {
    const p = projectPeriod(B, DAYS, 'month', '2026-10-01', {});
    const fromDevices = p.devices.reduce((a, r) => a + (r.energy_kwh ?? 0), 0);
    const fromDays = p.daily.reduce((a, d) => a + (d.energy_kwh ?? 0), 0);
    const fromCircuitDays = p.deviceDaily.available ? p.deviceDaily.rows.reduce((a, r) => a + (r.energy_kwh ?? 0), 0) : NaN;
    expect(fromDevices).toBeCloseTo(p.building.energy_kwh as number, 9);
    expect(fromDays).toBeCloseTo(p.building.energy_kwh as number, 9);
    expect(fromCircuitDays).toBeCloseTo(p.building.energy_kwh as number, 9);
    const first = p.days[0];
    expect(p.daily[0].energy_kwh).toBeCloseTo(kwhOf(first.donor.meters.m_ac.w[0]), 9);
  });

  it('is a complete period by the page\'s own rules, so nothing is refused or called partial', () => {
    const p = projectPeriod(B, DAYS, 'week', '2026-10-05', {});
    expect(coverageOf(p.building.online_sample_count, p.building.expected_sample_count)?.band).toBe('complete');
    for (const r of p.devices) expect(usableEnergy(r)).not.toBeNull();
    for (const d of p.daily) expect(coverageOf(d.usable_sample_count, d.expected_samples)?.band).toBe('complete');
    expect(p.summary.usable_minutes).toBe(7 * 1440);
  });

  it('draws its demand from the days\' own hours: the highest minute, the typical day, the levels', () => {
    const p = projectPeriod(B, DAYS, 'week', '2026-10-05', {});
    const highest = Math.max(...p.days.map((d) => Math.max(...d.donor.max_w)));
    expect(p.building.peak_total_power_w).toBe(highest);
    expect(p.summary.max_w).toBe(highest);
    expect(p.summary.resolution).toBe('hour');
    expect(p.hours).toHaveLength(24);
    expect(p.matrix).toHaveLength(7 * 24);
    expect(p.curve).toHaveLength(101);
    expect(p.curve[0].power_w).toBeGreaterThanOrEqual(p.curve[100].power_w as number);
  });

  it('gives a day its hours per circuit, and a period its circuits hour by hour', () => {
    const d = projectPeriod(B, DAYS, 'day', '2026-10-07', {});
    expect(d.hourEnergy).toHaveLength(2 * 24);
    expect(d.hourEnergy.reduce((a, r) => a + (r.energy_kwh ?? 0), 0)).toBeCloseTo(d.building.energy_kwh as number, 9);
    const w = projectPeriod(B, DAYS, 'week', '2026-10-05', {});
    expect(w.trend.series.map((s) => s.meterId)).toEqual(['m_light', 'm_ac']);
    expect(w.trend.series[0].slots).toHaveLength(7 * 24);
    expect(w.trend.startMs).toBe(Date.parse('2026-10-05T00:00:00Z') - 8 * 3_600_000);
  });

  it('says on each day which recorded day it is', () => {
    const p = projectPeriod(B, DAYS, 'week', '2026-10-05', {});
    const note = p.notes[p.days[0].date];
    expect(note).toMatch(/^From (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} (Aug|Sep), scaled × 0\.97$/);
  });

  it('lays itself on the period\'s own calendar', () => {
    expect(projectPeriod(B, DAYS, 'month', '2028-02-01', {}).daily.map((d) => d.local_day)).toEqual(periodDates('month', '2028-02-01'));
  });
});

describe('this site\'s baseline, projected', () => {
  it('lays September 2026 out as thirty different-looking days that keep the baseline\'s month', async () => {
    const { SITE_BASELINE } = await import('./baselineCompare');
    const { loadBaselineDays } = await import('@shared/siteConfig.mjs');
    const { BASELINE_DAYS } = await loadBaselineDays();
    const b = SITE_BASELINE as ProjectedBaseline;
    const p = projectPeriod(b, BASELINE_DAYS as unknown as BaselineDays, 'month', '2026-09-01', {});
    expect(p.daily).toHaveLength(30);
    const working = p.daily.filter((d) => ![0, 6].includes(new Date(`${d.local_day}T00:00:00Z`).getUTCDay())).map((d) => d.energy_kwh as number);
    expect(working).toHaveLength(22);
    // Real spread, not one averaged day thirty times.
    expect(Math.max(...working) - Math.min(...working)).toBeGreaterThan(5);
    // And the month the baseline publishes: 22 working days, 4 Saturdays and 4 Sundays of it, within a few kWh.
    const expected = 22 * b.day_types.working.kwh.total + 4 * b.day_types.saturday.kwh.total + 4 * b.day_types.sunday.kwh.total;
    expect(Math.abs((p.building.energy_kwh as number) - expected)).toBeLessThan(12);
  });
});
