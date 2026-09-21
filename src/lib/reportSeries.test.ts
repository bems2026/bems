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
  toDemandSummary,
  toHourEnergyPoints,
  type HourEnergyRow,
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

describe('toDemandSummary', () => {
  const row = (o: Record<string, unknown> = {}) => ({
    n: 10082,
    p50_w: 100,
    p95_w: 1350,
    p99_w: 1900,
    max_w: 2426,
    min_w: 20,
    observed_minutes: 10082,
    usable_minutes: 10082,
    expected_minutes: 10080,
    longest_gap_minutes: 3,
    resolution: 'minute',
    ...o,
  });

  it('never says more minutes were recorded than the period has', () => {
    // Live, week of 2026-09-07: 10,082 rows in 10,074 distinct minutes, because every ingest restart writes a
    // second row inside the minute the previous tick already wrote. The page read "10,082 of 10,080 minutes".
    const s = toDemandSummary(row());
    expect(s.usable_minutes).toBe(10080);
    expect(s.observed_minutes).toBe(10080);
    expect(s.expected_minutes).toBe(10080);
  });

  it('leaves an honest count alone, and a period with no expected minutes untouched', () => {
    expect(toDemandSummary(row({ usable_minutes: 2710, observed_minutes: 5000 }))).toMatchObject({ usable_minutes: 2710, observed_minutes: 5000 });
    expect(toDemandSummary(row({ expected_minutes: 0, usable_minutes: 0, observed_minutes: 0 }))).toMatchObject({ usable_minutes: 0, expected_minutes: 0 });
  });
});

describe('toHourEnergyPoints — RM-124', () => {
  const row = (over: Partial<HourEnergyRow> = {}): HourEnergyRow => ({
    device_id: 'mtr_co_yellow',
    local_day: '2026-09-19',
    local_hour: 10,
    energy_kwh: 0.75,
    clipped: false,
    avg_power_w: 750,
    max_power_w: 1200,
    online_minutes: 60,
    resolution: 'minute',
    ...over,
  });

  it('is always twenty-four points, 0 to 23, whatever hours the rows cover', () => {
    const pts = toHourEnergyPoints([row()]);
    expect(pts).toHaveLength(24);
    expect(pts.map((p) => p.hour)).toEqual(Array.from({ length: 24 }, (_, h) => h));
    expect(pts[10].kwh).toBe(0.75);
    expect(pts[11]).toMatchObject({ kwh: null, observed: false, minutes: 0 });
  });

  it('sums the devices it is given hour by hour — the building is a sum of its branch meters', () => {
    const pts = toHourEnergyPoints([
      row({ device_id: 'mtr_co_yellow', energy_kwh: 0.75, avg_power_w: 750 }),
      row({ device_id: 'mtr_lo_yellow', energy_kwh: 0.04, avg_power_w: 40 }),
      row({ device_id: 'mtr_lo_red', energy_kwh: null, avg_power_w: null, online_minutes: 0, resolution: null }),
    ]);
    expect(pts[10].kwh).toBeCloseTo(0.79, 6);
    expect(pts[10].avgW).toBe(790);
    expect(pts[10].observed).toBe(true);
    expect(pts[10].maxW).toBeNull();
  });

  it('keeps an hour no device carried a counter for as null, never zero', () => {
    const pts = toHourEnergyPoints([row({ energy_kwh: null, online_minutes: 12 }), row({ device_id: 'b', energy_kwh: null, online_minutes: 12 })]);
    expect(pts[10].kwh).toBeNull();
    expect(pts[10].observed).toBe(true);
    expect(pts[10].minutes).toBe(12);
  });

  it('flags the hour clipped when any device\'s counter was, and keeps a single device\'s highest reading', () => {
    const one = toHourEnergyPoints([row({ clipped: true })]);
    expect(one[10].clipped).toBe(true);
    expect(one[10].maxW).toBe(1200);
    const two = toHourEnergyPoints([row(), row({ device_id: 'b', clipped: true })]);
    expect(two[10].clipped).toBe(true);
  });

  it('reads minutes as the most any one device recorded, not their sum — they ran in the same hour', () => {
    const pts = toHourEnergyPoints([row({ online_minutes: 60 }), row({ device_id: 'b', online_minutes: 58 })]);
    expect(pts[10].minutes).toBe(60);
  });
});
