import { describe, it, expect, vi } from 'vitest';

vi.mock('@/config/supabase', () => ({ supabase: null }));

import {
  toDailyPoints,
  toHourPoints,
  toHeatCells,
  toDurationPoints,
  MAX_MATRIX_CELLS,
  type DailyRow,
  type HourRow,
  type MatrixRow,
  type CurveRow,
} from './reportSeries';

/**
 * The mappers are where phase37's rows become chart inputs, and where the one distinction the
 * whole series layer exists to preserve either survives or is quietly lost.
 *
 * `sample_count` is rows; `usable_sample_count` is rows carrying a real reading. On 2026-08-18
 * the live project holds 1,414 of the first and 0 of the second. A mapper that reaches for the
 * wrong one hands the chart a fully observed day that used no electricity, and every honesty
 * rule downstream is then keeping a promise about the wrong number.
 */

const daily = (over: Partial<DailyRow> = {}): DailyRow => ({
  local_day: '2026-08-17',
  energy_kwh: 14.68,
  peak_power_w: 1768,
  avg_power_w: 300,
  sample_count: 1440,
  usable_sample_count: 1440,
  expected_samples: 1440,
  first_seen_minute: 0,
  last_seen_minute: 1439,
  resolution: 'minute',
  ...over,
});

describe('toDailyPoints', () => {
  it('takes observed from USABLE samples, not from rows', () => {
    // 2026-08-18 exactly: a full day of rows, none of them a reading, counter frozen at 0 kWh.
    const [p] = toDailyPoints([daily({ local_day: '2026-08-18', energy_kwh: 0, peak_power_w: null, sample_count: 1414, usable_sample_count: 0 })]);
    expect(p.observed).toBe(false);
  });

  it('treats a day with real readings as observed', () => {
    expect(toDailyPoints([daily()])[0].observed).toBe(true);
  });

  it('defers to coverageOf for what counts as complete', () => {
    // 95% is the band boundary, and it lives in one place. A second threshold here would drift
    // from the one the figures beside the chart are qualified by.
    expect(toDailyPoints([daily({ usable_sample_count: 1368 })])[0].complete).toBe(true);
    expect(toDailyPoints([daily({ usable_sample_count: 1367 })])[0].complete).toBe(false);
    // 2026-08-19: 166 usable minutes of 1,440. A floor, not a total.
    expect(toDailyPoints([daily({ usable_sample_count: 166 })])[0].complete).toBe(false);
  });

  it('labels each bar with its day of the month, not the ISO date', () => {
    expect(toDailyPoints([daily({ local_day: '2026-08-07' })])[0].label).toBe('7');
  });

  it('reads the day as written rather than through the reader\'s timezone', () => {
    // `local_day` is a bare date the SQL already resolved in the building's own zone. Parsing it
    // as an instant and re-formatting it would shift it by the reader's offset — the trap
    // `supabaseReports.formatMonth` documents, in a different disguise.
    expect(toDailyPoints([daily({ local_day: '2026-08-01' })])[0].day).toBe('2026-08-01');
    expect(toDailyPoints([daily({ local_day: '2026-08-31' })])[0].label).toBe('31');
  });

  it('passes a null energy through as null', () => {
    expect(toDailyPoints([daily({ energy_kwh: null, usable_sample_count: 0 })])[0].kwh).toBeNull();
  });
});

describe('toHourPoints', () => {
  const hour = (over: Partial<HourRow> = {}): HourRow => ({
    local_hour: 14,
    n: 1085,
    p50_w: 825,
    p95_w: 1829,
    max_w: 4027,
    resolution: 'minute',
    ...over,
  });

  it('keeps an unobserved hour as a point with no statistics', () => {
    // Dropping the row would renumber the axis; zeroing it would claim the building drew nothing.
    const [p] = toHourPoints([hour({ n: 0, p50_w: null, p95_w: null, max_w: null })]);
    expect(p.n).toBe(0);
    expect(p.p50).toBeNull();
    expect(p.max).toBeNull();
  });

  it('carries the percentiles through', () => {
    const [p] = toHourPoints([hour()]);
    expect(p.p50).toBe(825);
    expect(p.p95).toBe(1829);
    expect(p.max).toBe(4027);
  });

  it('orders by hour whatever order the rows arrive in', () => {
    const rows = [hour({ local_hour: 9 }), hour({ local_hour: 2 }), hour({ local_hour: 23 })];
    expect(toHourPoints(rows).map((p) => p.hour)).toEqual([2, 9, 23]);
  });
});

describe('toHeatCells', () => {
  const cell = (over: Partial<MatrixRow> = {}): MatrixRow => ({
    local_day: '2026-08-17',
    local_hour: 14,
    avg_power_w: 800,
    max_power_w: 1200,
    sample_count: 60,
    usable_sample_count: 60,
    resolution: 'minute',
    ...over,
  });

  it('blanks a cell that holds rows but no readings', () => {
    // 153 of August's 744 cells are this. Painted from `avg_power_w` alone they would take a
    // colour from the ramp and read as a quiet hour.
    const [c] = toHeatCells([cell({ sample_count: 60, usable_sample_count: 0, avg_power_w: null })]);
    expect(c.value).toBeNull();
  });

  it('blanks a cell whose average is null even when rows were counted usable', () => {
    // Belt and braces: the two ought to agree, and if they ever do not, the absent number wins.
    const [c] = toHeatCells([cell({ usable_sample_count: 60, avg_power_w: null })]);
    expect(c.value).toBeNull();
  });

  it('keeps an observed cell', () => {
    expect(toHeatCells([cell()])[0].value).toBe(800);
  });
});

describe('toDurationPoints', () => {
  const point = (over: Partial<CurveRow> = {}): CurveRow => ({ pct: 0, power_w: 4551, resolution: 'minute', ...over });

  it('carries pct and watts through', () => {
    const [p] = toDurationPoints([point({ pct: 25, power_w: 1200 })]);
    expect(p).toEqual({ pct: 25, w: 1200 });
  });

  it('keeps a null rather than dropping the point', () => {
    // The chart breaks its line at a null; removing the row would join across it instead.
    expect(toDurationPoints([point({ power_w: null })])[0].w).toBeNull();
  });

  it('orders by pct', () => {
    const rows = [point({ pct: 50 }), point({ pct: 0 }), point({ pct: 100 })];
    expect(toDurationPoints(rows).map((p) => p.pct)).toEqual([0, 50, 100]);
  });
});

describe('the matrix cap matches the one the SQL enforces', () => {
  it('is 900, below PostgREST own silent 1000', () => {
    // phase37's report_hour_matrix raises above 900. If these two ever disagree, the client
    // would either reject a legal answer or trust a truncated one.
    expect(MAX_MATRIX_CELLS).toBe(900);
  });
});
