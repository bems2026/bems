import { describe, it, expect } from 'vitest';
import { mapReadingsRows } from './supabaseHistory';

describe('mapReadingsRows', () => {
  it('maps a full row straight through', () => {
    const points = mapReadingsRows([{ ts: '2026-08-10T09:00:00Z', power_w: 402.1, voltage: 221.4, current: 1.82 }]);
    expect(points).toEqual([{ ts: '2026-08-10T09:00:00Z', power_w: 402.1, voltage: 221.4, current: 1.82 }]);
  });

  it('drops rows with power_w: null rather than coercing to 0 — offline/unmetered points create a gap, not a fabricated zero', () => {
    const points = mapReadingsRows([
      { ts: 't1', power_w: 100, voltage: 220, current: 0.5 },
      { ts: 't2', power_w: null, voltage: null, current: null },
      { ts: 't3', power_w: 90, voltage: 219, current: 0.4 },
    ]);
    expect(points.map((p) => p.ts)).toEqual(['t1', 't3']);
  });

  it('maps null voltage/current to undefined, not 0, on rows that do have power', () => {
    const points = mapReadingsRows([{ ts: 't1', power_w: 50, voltage: null, current: null }]);
    expect(points[0].voltage).toBeUndefined();
    expect(points[0].current).toBeUndefined();
    expect(points[0].power_w).toBe(50);
  });

  it('returns an empty array for an empty input, not an error', () => {
    expect(mapReadingsRows([])).toEqual([]);
  });
});
