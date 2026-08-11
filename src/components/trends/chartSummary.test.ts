import { describe, it, expect } from 'vitest';
import { summarizeTrend, trendStats, downsampleTrend } from './chartSummary';

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
});
