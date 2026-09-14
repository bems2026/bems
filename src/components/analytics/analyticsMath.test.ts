import { describe, it, expect } from 'vitest';
import { buildChartRows, pairTotalAndMetered, seriesKey } from './analyticsMath';
import type { HistoryPoint } from '@/lib/types';

/*
 * RM-076. These replace the index-zip tests: `buildChartRows` and `alignTotalAndMetered` used to pair
 * devices by ARRAY POSITION, which was only right while every device had exactly the same number of
 * samples stamped at exactly the same moments — and the bridge stamps arrival time, so neither held
 * on the live building (see `lib/timeseries.ts`). The rules the old tests pinned — no fabricated 0,
 * gaps stay gaps, the two sides of "Metered vs total" suppressed independently — are all kept.
 */

const MIN = 60_000;
const T0 = Date.parse('2026-09-13T15:00:00+08:00');
const at = (minute: number, second = 5) => new Date(T0 + minute * MIN + second * 1000).toISOString();
const pt = (minute: number, power_w: number, over: Partial<HistoryPoint> = {}): HistoryPoint => ({
  ts: at(minute),
  power_w,
  voltage: 228 + (minute % 3) * 0.1,
  current: Math.round((power_w / 228) * 1000) / 1000,
  online: true,
  ...over,
});
const series = (from: number, count: number, power: (minute: number) => number, over: Partial<HistoryPoint> = {}) =>
  Array.from({ length: count }, (_, i) => pt(from + i, power(from + i), over));
const opts = (minutesAfterT0: number) => ({ range: '24h' as const, nowMs: T0 + minutesAfterT0 * MIN + 30_000 });
const rowAt = <R extends { t?: number }>(rows: R[], minute: number) => rows.find((r) => r.t === T0 + minute * MIN);

describe('buildChartRows', () => {
  it('returns no rows when no device has any history', () => {
    expect(buildChartRows(['a', 'b'], {}, 140, 'power', opts(10)).rows).toEqual([]);
  });

  it('joins devices on the same minute, not the same array position', () => {
    const a = series(0, 10, (m) => 100 + m);
    const b = series(1, 9, (m) => 1000 + m); // one sample fewer, starting a minute later
    const { rows } = buildChartRows(['a', 'b'], { a, b }, 140, 'power', opts(10));
    expect(rowAt(rows, 5)).toMatchObject({ a: 105, b: 1005 });
    expect(rowAt(rows, 0)?.b).toBeUndefined();
  });

  it('gives a device with no history nothing at every row, never a fabricated 0', () => {
    const { rows } = buildChartRows(['a', 'missing'], { a: series(0, 5, (m) => m + 1) }, 140, 'power', opts(5));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.missing === undefined && r[seriesKey('missing', 'interpolated')] === undefined)).toBe(true);
  });

  it('charts the selected parameter, and gaps a point that never carried it', () => {
    const withVA: HistoryPoint[] = [
      { ts: at(0), power_w: 100, voltage: 230, current: 0.43, online: true },
      { ts: at(1), power_w: 110, online: true }, // pre-dates V/A recording
    ];
    expect(rowAt(buildChartRows(['a'], { a: withVA }, 140, 'voltage', opts(1)).rows, 0)?.a).toBe(230);
    expect(rowAt(buildChartRows(['a'], { a: withVA }, 140, 'voltage', opts(1)).rows, 1)?.a).toBeUndefined();
    expect(rowAt(buildChartRows(['a'], { a: withVA }, 140, 'current', opts(1)).rows, 0)?.a).toBe(0.43);
    expect(rowAt(buildChartRows(['a'], { a: withVA }, 140, 'power', opts(1)).rows, 1)?.a).toBe(110);
  });

  it('draws no more rows than it was given room for', () => {
    const { rows } = buildChartRows(['a'], { a: series(0, 600, (m) => m) }, 60, 'power', opts(600));
    expect(rows.length).toBeLessThanOrEqual(60);
    expect(rows.length).toBeGreaterThan(50);
  });

  it('starts at the first reading rather than drawing a day of nothing before the buffer began', () => {
    const model = buildChartRows(['a'], { a: series(0, 5, () => 50) }, 140, 'power', opts(5));
    expect(model.rows[0].t).toBe(T0);
    expect(model.gaps.a).toEqual([]);
  });

  it("draws CARE ACU's one-minute flicker as a bridge on its own series, touching the solid line both sides", () => {
    const a = [pt(0, 14.8), pt(1, 15.7, { online: false }), pt(2, 15.5), pt(3, 15.4)];
    const model = buildChartRows(['a'], { a }, 140, 'power', opts(3));
    const key = seriesKey('a', 'interpolated');
    expect(rowAt(model.rows, 1)?.a).toBeUndefined();
    expect(rowAt(model.rows, 1)?.[key]).toBeCloseTo(15.15, 6);
    expect(rowAt(model.rows, 0)?.[key]).toBe(14.8);
    expect(rowAt(model.rows, 2)?.[key]).toBe(15.5);
    expect(rowAt(model.rows, 3)?.[key]).toBeUndefined();
    expect(model.meta[1].a).toMatchObject({ quality: 'interpolated', raw: 15.7, imputedFrom: 'offline' });
  });

  it('draws a frozen stretch on its own series and reports it, rather than as a measurement', () => {
    const frozen = Array.from({ length: 70 }, (_, i) => ({ ts: at(1 + i), power_w: 19.1, voltage: 228.2, current: 0.576, online: true }));
    const model = buildChartRows(['a'], { a: [pt(0, 13), ...frozen, pt(71, 12)] }, 140, 'power', opts(71));
    expect(model.frozen.a).toHaveLength(1);
    expect(rowAt(model.rows, 10)?.a).toBeUndefined();
    expect(rowAt(model.rows, 10)?.[seriesKey('a', 'frozen')]).toBe(19.1);
    expect(model.quality.a.frozen).toBe(70);
  });

  it('names the 09-07 restart as a window instead of leaving an unexplained blank', () => {
    const model = buildChartRows(['a'], { a: [pt(0, 650), pt(1, 651), pt(6, 648), pt(7, 647)] }, 140, 'power', opts(7));
    expect(model.gaps.a).toEqual([{ fromMs: T0 + 2 * MIN, toMs: T0 + 6 * MIN, kind: 'missing', slots: 4 }]);
  });

  it('rejects a 1,000,000 kW glitch and bridges the minute rather than drawing it', () => {
    const model = buildChartRows(['a'], { a: [pt(0, 400), pt(1, 1_000_000_000), pt(2, 410)] }, 140, 'power', opts(2));
    expect(rowAt(model.rows, 1)?.a).toBeUndefined();
    expect(rowAt(model.rows, 1)?.[seriesKey('a', 'interpolated')]).toBe(405);
    expect(model.meta[1].a).toMatchObject({ imputedFrom: 'outlier', raw: 1_000_000_000 });
  });

  it('ends at the live reading, so the chart and the live tiles agree', () => {
    const live = { a: { ts: at(6, 20), value: 140, online: true } };
    const model = buildChartRows(['a'], { a: series(0, 5, () => 100) }, 140, 'power', { ...opts(6), live });
    const last = model.rows[model.rows.length - 1];
    expect(last.a).toBe(140);
    expect(model.meta[model.meta.length - 1].a.quality).toBe('live');
  });
});

describe('pairTotalAndMetered', () => {
  it('adds each side minute by minute, in kW', () => {
    const { rows } = pairTotalAndMetered([series(0, 5, () => 1000), series(0, 5, () => 500)], [series(0, 5, () => 200)], { ...opts(4), maxPoints: 120 });
    expect(rowAt(rows, 2)).toMatchObject({ totalKw: 1.5, meteredKw: 0.2 });
  });

  /*
   * Measured on the Pi 2026-09-01: `co5` carried a frozen 513.9 W across 60 offline points while the
   * building drew ~35 W. Blanking both lines would hide a real measurement to report a missing one.
   */
  it('suppresses the two sides independently — an offline outlet must not blank the panel total', () => {
    const outlet = [pt(0, 20), ...[1, 2, 3, 4].map((m) => pt(m, 513.9, { online: false })), pt(5, 20)];
    const { rows } = pairTotalAndMetered([series(0, 6, () => 900)], [outlet], { ...opts(5), maxPoints: 120 });
    expect(rowAt(rows, 2)?.totalKw).toBe(0.9);
    expect(rowAt(rows, 2)?.meteredKw).toBeUndefined();
  });

  it('draws a frozen branch in the panel total as frozen, not as an unexplained blank', () => {
    const frozen = Array.from({ length: 70 }, (_, i) => ({ ts: at(i), power_w: 19.1, voltage: 228.2, current: 0.576, online: true }));
    const { rows } = pairTotalAndMetered([frozen, series(0, 70, () => 900)], [series(0, 70, () => 200)], { ...opts(69), maxPoints: 120 });
    expect(rowAt(rows, 30)?.totalKw).toBeUndefined();
    expect(rowAt(rows, 30)?.totalFrozenKw).toBeCloseTo(0.9191, 6);
    expect(rowAt(rows, 30)?.meteredKw).toBe(0.2);
  });

  it('is empty when neither side has any history', () => {
    expect(pairTotalAndMetered([], [], { ...opts(5), maxPoints: 120 }).rows).toEqual([]);
  });
});
