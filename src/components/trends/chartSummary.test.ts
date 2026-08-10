import { describe, it, expect } from 'vitest';
import { summarizeTrend } from './chartSummary';

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
