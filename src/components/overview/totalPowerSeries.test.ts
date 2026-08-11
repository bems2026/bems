import { describe, it, expect } from 'vitest';
import { sumHistories } from './totalPowerSeries';

const pt = (ts: string, power_w: number) => ({ ts, power_w });

describe('sumHistories', () => {
  it('is empty for no series', () => {
    expect(sumHistories([])).toEqual([]);
  });

  it('is empty when every series is empty', () => {
    expect(sumHistories([[], []])).toEqual([]);
  });

  it('sums index-aligned series, using the first series timestamps', () => {
    const a = [pt('t0', 100), pt('t1', 110)];
    const b = [pt('t0', 50), pt('t1', 60)];
    expect(sumHistories([a, b])).toEqual([pt('t0', 150), pt('t1', 170)]);
  });

  it('sums three series', () => {
    const a = [pt('t0', 1)];
    const b = [pt('t0', 2)];
    const c = [pt('t0', 3)];
    expect(sumHistories([a, b, c])).toEqual([pt('t0', 6)]);
  });

  it('right-aligns to the shortest series when lengths differ, using the newest points', () => {
    const a = [pt('t-1', 999), pt('t0', 100), pt('t1', 110)];
    const b = [pt('t0', 50), pt('t1', 60)];
    expect(sumHistories([a, b])).toEqual([pt('t0', 150), pt('t1', 170)]);
  });

  it('ignores an empty series among non-empty ones rather than zeroing the whole sum', () => {
    const a = [pt('t0', 100)];
    const empty: { ts: string; power_w: number }[] = [];
    expect(sumHistories([a, empty])).toEqual([pt('t0', 100)]);
  });
});
