import { describe, it, expect } from 'vitest';
import { buildChartRows, alignTotalAndMetered } from './analyticsMath';
import type { HistoryPoint } from '@/lib/types';

const series = (n: number, power: (i: number) => number, startMs = 0, stepMs = 60000): HistoryPoint[] =>
  Array.from({ length: n }, (_, i) => ({ ts: new Date(startMs + i * stepMs).toISOString(), power_w: power(i) }));

describe('buildChartRows', () => {
  it('returns an empty array when no device has any history', () => {
    expect(buildChartRows(['a', 'b'], {}, 10)).toEqual([]);
  });

  it('zips two devices\' downsampled series by index into one row per point', () => {
    const rows = buildChartRows(['a', 'b'], { a: series(10, (i) => i), b: series(10, (i) => i * 2) }, 10);
    expect(rows.length).toBe(10);
    expect(rows[5].a).toBe(5);
    expect(rows[5].b).toBe(10);
  });

  /*
   * Reversed deliberately: this used to assert `=== 0`, matching an old `?? 0` fallback.
   * That fallback drew a device with no history as a flat 0 W line across the whole window
   * — a claim the building was measured at zero, when in fact nothing was measured at all.
   * `types.ts` states the rule this violates: "no data" and "zero watts" are different
   * facts. Undefined makes Recharts (with `connectNulls={false}`) draw nothing, while the
   * legend still lists the device, so "we have no readings" reads as exactly that.
   */
  it('a device with no history contributes undefined, not a fabricated 0, at every row', () => {
    const rows = buildChartRows(['a', 'missing'], { a: series(5, (i) => i + 1) }, 5);
    expect(rows.every((r) => r.missing === undefined)).toBe(true);
    expect(rows.every((r) => r.a !== undefined)).toBe(true);
  });

  it('charts the selected parameter, and gaps a point that never carried it', () => {
    const withVA: HistoryPoint[] = [
      { ts: new Date(0).toISOString(), power_w: 100, voltage: 230, current: 0.43 },
      { ts: new Date(60000).toISOString(), power_w: 110 }, // pre-dates V/A recording
    ];
    const volts = buildChartRows(['a'], { a: withVA }, 5, 'voltage');
    expect(volts[0].a).toBe(230);
    expect(volts[1].a).toBeUndefined();
    expect(buildChartRows(['a'], { a: withVA }, 5, 'current')[0].a).toBe(0.43);
    expect(buildChartRows(['a'], { a: withVA }, 5, 'power')[1].a).toBe(110);
  });

  it('downsamples down to maxPoints when the raw series is longer', () => {
    const rows = buildChartRows(['a'], { a: series(100, (i) => i) }, 10);
    expect(rows.length).toBe(10);
  });
});

describe('alignTotalAndMetered', () => {
  it('pairs total and metered by index, right-aligned to the shorter series', () => {
    const total = series(5, (i) => 100 + i);
    const metered = series(3, (i) => 20 + i);
    const paired = alignTotalAndMetered(total, metered);
    expect(paired.length).toBe(3);
    expect(paired[0].total).toBe(102); // right-aligned: total[2..4]
    expect(paired[0].metered).toBe(20);
  });

  it('returns empty when either series is empty', () => {
    expect(alignTotalAndMetered([], series(3, () => 1))).toEqual([]);
    expect(alignTotalAndMetered(series(3, () => 1), [])).toEqual([]);
  });
});
