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

/**
 * A summed series was the one place a frozen reading could still reach a chart.
 *
 * FI-010/EX-102 gave every history point an `online` flag and made `pointValue` return
 * `undefined` for an offline one, so a device that stopped reporting leaves a gap instead of a
 * confident flat line. `pointValue`'s own comment calls itself "the one place a point becomes a
 * plotted number" — but `sumHistories` never went through it. It added `power_w` straight.
 *
 * Measured on the Pi 2026-09-01: `co5` had 60 consecutive history points, every one marked
 * `online: false`, every one carrying a frozen **513.9 W** from before it left the network. The
 * building was drawing ~35 W at the time, so Analytics' "Metered vs total" chart was plotting an
 * outlet line inflated by roughly fifteen times the whole building's real demand — and
 * `Math.max(0, total - metered)` then clamped the resulting contradiction to "0.00 kW untracked",
 * hiding it rather than showing it.
 *
 * A dip or spike in a summed line is indistinguishable from the building actually using more or
 * less. That is the misreading with real cost: somebody reads an energy saving that was a
 * disconnection.
 */
describe('sumHistories and offline contributors', () => {
  const on = (ts: string, power_w: number) => ({ ts, power_w, online: true });
  const off = (ts: string, power_w: number) => ({ ts, power_w, online: false });

  it('marks a summed point offline when any contributor was offline at that point', () => {
    // NOT summed-with-the-offline-value (a fabrication) and NOT summed-as-zero (a different
    // fabrication — it claims the circuit drew nothing). The sum is simply not known.
    const a = [on('t0', 100), on('t1', 110)];
    const b = [on('t0', 50), off('t1', 513.9)];
    const out = sumHistories([a, b]);
    expect(out[0].online).toBe(true);
    expect(out[1].online).toBe(false);
  });

  it('keeps the array length, so index alignment against another series still holds', () => {
    const a = [on('t0', 1), on('t1', 2), on('t2', 3)];
    const b = [off('t0', 9), on('t1', 2), on('t2', 3)];
    expect(sumHistories([a, b])).toHaveLength(3);
  });

  it('leaves a point with no online field alone — unknown is not false', () => {
    // Points predating EX-102 have no flag. Suppressing them would erase real history in the
    // name of honesty, which is its own kind of lie.
    const a = [pt('t0', 100)];
    const b = [pt('t0', 50)];
    expect(sumHistories([a, b])[0].online).toBeUndefined();
  });

  it('reports a point as offline even when the offline contributor reads zero', () => {
    // co4 and co6 are offline carrying 0 W. Zero is not harmless here: it asserts the circuit
    // drew nothing, when what is true is that nobody knows.
    const a = [on('t0', 100)];
    const b = [off('t0', 0)];
    expect(sumHistories([a, b])[0].online).toBe(false);
  });
});
