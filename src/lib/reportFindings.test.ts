import { describe, it, expect } from 'vitest';
import { loadFactor, overnightBaseLoad, weekdayWeekend } from './reportFindings';
import type { DailyRow, DemandSummary, HourRow } from './reportSeries';

/**
 * RM-084 — three findings the report's own series already hold.
 *
 * Each is a statement a facilities manager acts on, and each has a way to be quietly wrong: an
 * average over partial days, a ratio over a period nobody watched, a "base load" from two hours.
 * Every one returns `null` with a reason in words rather than a number it cannot stand behind.
 */

const day = (local_day: string, o: Partial<DailyRow> = {}): DailyRow => ({
  local_day,
  energy_kwh: 20,
  peak_power_w: 2000,
  avg_power_w: 500,
  sample_count: 1440,
  usable_sample_count: 1440,
  expected_samples: 1440,
  first_seen_minute: 0,
  last_seen_minute: 1439,
  resolution: 'minute',
  ...o,
});

// August 2026: the 1st is a Saturday, the 3rd a Monday, the 8th and 9th a weekend.
const WEEK = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07'].map((d) => day(d));
const WEEKEND = ['2026-08-08', '2026-08-09'].map((d) => day(d, { energy_kwh: 2 }));

describe('weekdayWeekend', () => {
  it('averages a weekday and a weekend day from complete days', () => {
    const result = weekdayWeekend([...WEEK, ...WEEKEND]);
    expect(result.weekday).toEqual({ kwh: 20, days: 5 });
    expect(result.weekend).toEqual({ kwh: 2, days: 2 });
    expect(result.reason).toBeNull();
  });

  it('counts only complete days — a partial day is a floor, not a day', () => {
    // 2026-08-10 is a Monday that saw 166 minutes. Averaging its 1 kWh in would halve the weekday.
    const result = weekdayWeekend([...WEEK, ...WEEKEND, day('2026-08-10', { energy_kwh: 1, usable_sample_count: 166 })]);
    expect(result.weekday).toEqual({ kwh: 20, days: 5 });
  });

  it('ignores a day whose rows held no reading at all', () => {
    const result = weekdayWeekend([...WEEK, ...WEEKEND, day('2026-08-11', { energy_kwh: 0, usable_sample_count: 0 })]);
    expect(result.weekday.days).toBe(5);
  });

  it('refuses when there are too few complete days of either kind, and says which', () => {
    const result = weekdayWeekend([...WEEK, WEEKEND[0]]);
    expect(result.weekend.kwh).toBeNull();
    expect(result.weekday.kwh).toBeNull();
    expect(result.reason).toMatch(/at least 3 complete weekdays and 2 complete weekend days/);
    expect(result.reason).toMatch(/5 and 1/);
  });
});

describe('loadFactor', () => {
  const summary = (o: Partial<DemandSummary> = {}): DemandSummary => ({
    n: 2160,
    p50_w: 600,
    p95_w: 1500,
    p99_w: 1900,
    max_w: 2000,
    min_w: 50,
    observed_minutes: 2160,
    usable_minutes: 2160,
    expected_minutes: 2160,
    longest_gap_minutes: 0,
    resolution: 'minute',
    ...o,
  });

  it('divides the average demand, weighted by the minutes behind it, by the peak', () => {
    // 500 W over 1,440 minutes and 1,000 W over 720: the average is 666.7 W, not the 750 of a plain mean.
    const days = [day('2026-08-03', { avg_power_w: 500, usable_sample_count: 1440 }), day('2026-08-04', { avg_power_w: 1000, usable_sample_count: 720 })];
    const result = loadFactor(days, summary());
    expect(result.averageW).toBeCloseTo(666.667, 2);
    expect(result.ratio).toBeCloseTo(0.3333, 3);
    expect(result.qualified).toBe(false);
    expect(result.reason).toBeNull();
  });

  it('is qualified when the period was not fully observed', () => {
    const result = loadFactor([day('2026-08-03')], summary({ usable_minutes: 12006, expected_minutes: 44640 }));
    expect(result.ratio).not.toBeNull();
    expect(result.qualified).toBe(true);
  });

  it('refuses without a reading or without a peak, rather than dividing by nothing', () => {
    expect(loadFactor([day('2026-08-03', { usable_sample_count: 0 })], summary()).reason).toMatch(/nothing was observed/i);
    expect(loadFactor([day('2026-08-03')], summary({ max_w: null })).ratio).toBeNull();
    expect(loadFactor([day('2026-08-03')], null).ratio).toBeNull();
  });
});

describe('overnightBaseLoad', () => {
  const hour = (h: number, p50: number | null, n = 30): HourRow => ({ local_hour: h, n, p50_w: p50, p95_w: null, max_w: null, resolution: 'minute' });

  it('is the median of the typical demand between midnight and six', () => {
    const hours = [100, 120, 90, 110, 95, 105].map((w, h) => hour(h, w)).concat(hour(12, 900));
    expect(overnightBaseLoad(hours).w).toBeCloseTo(102.5, 6);
  });

  it('refuses from fewer than four of the six hours, and says so', () => {
    const hours = [hour(0, 100), hour(1, 120), hour(2, 90), hour(3, null, 0), hour(4, null, 0), hour(5, null, 0)];
    const result = overnightBaseLoad(hours);
    expect(result.w).toBeNull();
    expect(result.reason).toMatch(/at least 4 of the 6 hours/);
  });
});
