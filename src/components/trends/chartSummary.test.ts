import { describe, it, expect } from 'vitest';
import { summarizeTrend, trendStats, downsampleTrend } from './chartSummary';
import { pointValue } from '@/components/analytics/chartParams';

describe('summarizeTrend', () => {
  it('reports no data rather than fabricating a range for an empty buffer', () => {
    expect(summarizeTrend('Outlet 3', '24h', [])).toBe('Outlet 3 power over 24 hours: no readings yet.');
  });

  it('reports count, min, max, and current from real points', () => {
    const points = [
      { ts: '2026-08-10T00:00:00+08:00', power_w: 100 },
      { ts: '2026-08-10T00:01:00+08:00', power_w: 402.4 },
      { ts: '2026-08-10T00:02:00+08:00', power_w: 12.1 },
      { ts: '2026-08-10T00:03:00+08:00', power_w: 388.9 },
    ];
    expect(summarizeTrend('Outlet 3', '24h', points)).toBe(
      'Outlet 3 power over 24 hours: 4 readings, ranging 12 to 402 watts, currently 389 watts.',
    );
  });

  it('uses the current (last) reading, not the max, as "currently"', () => {
    const points = [
      { ts: '2026-08-10T00:00:00+08:00', power_w: 500 },
      { ts: '2026-08-10T00:01:00+08:00', power_w: 50 },
    ];
    expect(summarizeTrend('L.O Red', '1h', points)).toContain('currently 50 watts');
  });

  it('spells out the range label', () => {
    expect(summarizeTrend('X', '1h', [{ ts: 't', power_w: 1 }])).toContain('over 1 hour:');
    expect(summarizeTrend('X', '6h', [{ ts: 't', power_w: 1 }])).toContain('over 6 hours:');
  });
});

describe('trendStats', () => {
  it('is null/null for an empty series', () => {
    expect(trendStats([])).toEqual({ peak: null, average: null });
  });

  it('finds the peak point (value and its own timestamp), not just the max value', () => {
    const points = [
      { ts: 'a', power_w: 100 },
      { ts: 'b', power_w: 402 },
      { ts: 'c', power_w: 50 },
    ];
    expect(trendStats(points).peak).toEqual({ power_w: 402, ts: 'b' });
  });

  it('averages the real values, not a downsampled approximation', () => {
    const points = [{ ts: 'a', power_w: 100 }, { ts: 'b', power_w: 200 }, { ts: 'c', power_w: 300 }];
    expect(trendStats(points).average).toBe(200);
  });
});

describe('downsampleTrend', () => {
  it('leaves a series at or under the cap untouched', () => {
    const points = [{ ts: 'a', power_w: 1 }, { ts: 'b', power_w: 2 }];
    expect(downsampleTrend(points, 5)).toEqual(points);
  });

  it('reduces a long series to exactly maxPoints', () => {
    const points = Array.from({ length: 1440 }, (_, i) => ({ ts: `t${i}`, power_w: i }));
    expect(downsampleTrend(points, 120)).toHaveLength(120);
  });

  it('averages within each bucket rather than picking a single sample', () => {
    // 4 points into 2 buckets: [0,10] avg 5, [20,30] avg 25.
    const points = [{ ts: 'a', power_w: 0 }, { ts: 'b', power_w: 10 }, { ts: 'c', power_w: 20 }, { ts: 'd', power_w: 30 }];
    const out = downsampleTrend(points, 2);
    expect(out.map((p) => p.power_w)).toEqual([5, 25]);
  });

  it('does not lose the overall min/max range to averaging at a reasonable bucket size', () => {
    const points = Array.from({ length: 1440 }, (_, i) => ({ ts: `t${i}`, power_w: i < 1439 ? 50 : 5000 })); // one huge spike at the end
    const out = downsampleTrend(points, 120);
    // The spike survives inside the last bucket's average — not necessarily as 5000
    // itself, but the last bucket must be visibly higher than the flat 50 baseline.
    expect(out[out.length - 1].power_w).toBeGreaterThan(50);
  });

  it('averages voltage/current over only the samples that carried them', () => {
    // Bucket 1 has one point with V/A and one without: the average must be the real
    // reading (230), NOT 115 — averaging a missing sample in as 0 would invent a
    // brownout that never happened.
    const points = [
      { ts: 'a', power_w: 10, voltage: 230, current: 0.04 },
      { ts: 'b', power_w: 10 },
      { ts: 'c', power_w: 10, voltage: 220, current: 0.05 },
      { ts: 'd', power_w: 10, voltage: 240, current: 0.03 },
    ];
    const out = downsampleTrend(points, 2);
    expect(out[0].voltage).toBe(230);
    expect(out[1].voltage).toBe(230); // (220 + 240) / 2
  });

  it('omits voltage/current entirely for a bucket where no sample carried them', () => {
    const points = [
      { ts: 'a', power_w: 10 },
      { ts: 'b', power_w: 20 },
      { ts: 'c', power_w: 30, voltage: 230 },
      { ts: 'd', power_w: 40, voltage: 230 },
    ];
    const out = downsampleTrend(points, 2);
    expect(out[0].voltage).toBeUndefined();
    expect('voltage' in out[0]).toBe(false);
    expect(out[1].voltage).toBe(230);
  });
});

/**
 * Downsampling silently defeated FI-010/EX-102 for exactly the ranges where it mattered most.
 *
 * That change gave every history point an `online` flag and made `pointValue` return `undefined`
 * for an offline one, so a device that stopped reporting leaves a gap instead of a confident
 * flat line drawn from its frozen last wattage. But `downsampleTrend` rebuilt each bucket as
 * `{ ts, power_w }` and copied only voltage and current — so the flag never survived, and
 * `pointValue` downstream had nothing to suppress on.
 *
 * The failure was invisible because it depends on length: a series at or under `maxPoints` is
 * returned untouched and keeps its flags, so the 1h and 6h charts behaved correctly while 24h
 * and the archive ranges — 1440 points and up, the ones an energy claim is actually read off —
 * quietly plotted frozen readings as measurements.
 *
 * Measured on the Pi 2026-09-01: `co5` held 60 consecutive offline points at a frozen 513.9 W
 * while the whole building drew ~35 W.
 */
describe('downsampleTrend and offline samples', () => {
  const on = (ts: string, power_w: number) => ({ ts, power_w, online: true });
  const off = (ts: string, power_w: number) => ({ ts, power_w, online: false });

  it('averages only the samples that were actually online', () => {
    // Same rule the voltage/current averaging above already uses: average over the samples that
    // carried a real value, rather than mixing a measurement with a frozen one.
    const points = [on('t0', 100), off('t1', 513.9), on('t2', 200), off('t3', 513.9)];
    const out = downsampleTrend(points, 2);
    expect(out[0].power_w).toBe(100);
    expect(out[1].power_w).toBe(200);
  });

  it('marks a bucket offline only when NO sample in it was online', () => {
    // Any-offline would throw away real readings either side of a dropout; all-offline keeps
    // every measurement and suppresses only the stretch where there were none.
    const points = [on('t0', 100), off('t1', 513.9), off('t2', 513.9), off('t3', 513.9)];
    const out = downsampleTrend(points, 2);
    expect(out[0].online).toBe(true);
    expect(out[1].online).toBe(false);
  });

  it('carries the flag through to pointValue, which is what actually suppresses the point', () => {
    const points = [off('t0', 513.9), off('t1', 513.9), on('t2', 40), on('t3', 42)];
    const out = downsampleTrend(points, 2);
    expect(pointValue(out[0], 'power')).toBeUndefined();
    expect(pointValue(out[1], 'power')).toBe(41);
  });

  it('omits the flag entirely for buckets of legacy points that never carried one', () => {
    // Unknown is not false. Points predating EX-102 must keep plotting.
    const out = downsampleTrend([{ ts: 't0', power_w: 1 }, { ts: 't1', power_w: 3 }], 1);
    expect('online' in out[0]).toBe(false);
    expect(pointValue(out[0], 'power')).toBe(2);
  });

  it('leaves a short series untouched, flags and all', () => {
    const points = [on('t0', 1), off('t1', 2)];
    expect(downsampleTrend(points, 10)).toBe(points);
  });
});

/**
 * `trendStats` carries a comment promising these numbers "stay accurate to the actual readings"
 * — and it summed every point including offline ones. A frozen 513.9 W repeated for an hour
 * would be reported as the building's peak, and dragged the average with it.
 */
describe('trendStats and offline samples', () => {
  const on = (ts: string, power_w: number) => ({ ts, power_w, online: true });
  const off = (ts: string, power_w: number) => ({ ts, power_w, online: false });

  it('never reports a frozen offline reading as the peak', () => {
    const stats = trendStats([on('t0', 40), off('t1', 513.9), on('t2', 60)]);
    expect(stats.peak?.power_w).toBe(60);
  });

  it('averages only what was actually measured', () => {
    const stats = trendStats([on('t0', 40), off('t1', 513.9), on('t2', 60)]);
    expect(stats.average).toBe(50);
  });

  it('reports nothing rather than something wrong when every sample was offline', () => {
    const stats = trendStats([off('t0', 513.9), off('t1', 513.9)]);
    expect(stats.peak).toBeNull();
    expect(stats.average).toBeNull();
  });

  it('is unchanged for legacy points with no flag', () => {
    const stats = trendStats([{ ts: 't0', power_w: 40 }, { ts: 't1', power_w: 60 }]);
    expect(stats.peak?.power_w).toBe(60);
    expect(stats.average).toBe(50);
  });
});
