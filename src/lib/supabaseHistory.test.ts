import { describe, it, expect } from 'vitest';
import { assertNotTruncated, mapReadingsRows } from './supabaseHistory';

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

describe('assertNotTruncated', () => {
  it('passes a result comfortably under the cap straight through', () => {
    const rows = [{ n: 1 }, { n: 2 }];
    expect(assertNotTruncated(rows, 900, 'ctx')).toBe(rows);
  });

  it('passes an empty result — no data is a real answer, not a truncated one', () => {
    expect(assertNotTruncated([], 900, 'ctx')).toEqual([]);
  });

  it('throws when the result is exactly the cap — the shape a silent truncation takes', () => {
    // The live bug: PostgREST capped 6,614 matching rows at exactly 1000 and reported
    // nothing. length === cap is the only tell there is, so it has to be treated as
    // truncation rather than as a complete answer that happens to be that long.
    const rows = Array.from({ length: 900 }, (_, i) => ({ n: i }));
    expect(() => assertNotTruncated(rows, 900, 'readings_buckets(mtr_co_yellow, 7d)')).toThrow(
      /truncated/i
    );
  });

  it('names the caller in the error, so a failure says which query was cut short', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ n: i }));
    expect(() => assertNotTruncated(rows, 5, 'readings_buckets(mtr_lo_red, 30d)')).toThrow(
      /readings_buckets\(mtr_lo_red, 30d\)/
    );
  });

  it('throws above the cap too, not only exactly at it', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ n: i }));
    expect(() => assertNotTruncated(rows, 10, 'ctx')).toThrow();
  });
});

describe('mapReadingsRows on bucket rows', () => {
  it('drops a bucket whose power averaged to null — no online sample in that window', () => {
    // readings_buckets averages `filter (where online)`, so a bucket covering an outage
    // yields null rather than the offline device's frozen last wattage. That has to stay a
    // gap in the chart; charting it as 0 W would be as much a fabrication as charting 746.5.
    const points = mapReadingsRows([
      { ts: 't1', power_w: 120, voltage: 230, current: 0.5, sample_count: 15, online_count: 15 },
      { ts: 't2', power_w: null, voltage: null, current: null, sample_count: 15, online_count: 0 },
      { ts: 't3', power_w: 118, voltage: 230, current: 0.5, sample_count: 15, online_count: 15 },
    ]);
    expect(points.map((p) => p.ts)).toEqual(['t1', 't3']);
  });

  it('ignores the extra bucket columns rather than leaking them into HistoryPoint', () => {
    const points = mapReadingsRows([
      { ts: 't1', power_w: 10, voltage: null, current: null, sample_count: 15, online_count: 3 },
    ]);
    expect(points[0]).toEqual({ ts: 't1', power_w: 10, voltage: undefined, current: undefined });
  });
});
