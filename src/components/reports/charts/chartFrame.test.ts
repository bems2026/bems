import { describe, it, expect } from 'vitest';
import { niceScale, linearScale, bandScale, plotBox, DEFAULT_MARGINS } from './chartFrame';

/**
 * The shared machinery every generator sits on: how a range of numbers becomes a range of
 * pixels, and how a count of buckets becomes a row of bars.
 *
 * Two of the assertions here are dataviz correctness rather than arithmetic — a bar axis that
 * does not start at zero, and an axis invented over no data at all. Both produce a chart that
 * is well-formed, plausible, and lying, which is the same failure this project has already paid
 * for twice: a truncated 7-day chart that "rendered with axes and a plausible curve, and wrong",
 * and an outage that disappeared from a report because the day was simply absent.
 */

describe('niceScale', () => {
  it('rounds the top of the axis out to a readable step', () => {
    const s = niceScale([14.01, 16.62, 21.83, 8.1], { zeroBased: true });
    expect(s).not.toBeNull();
    expect(s!.min).toBe(0);
    expect(s!.max).toBeGreaterThanOrEqual(21.83);
    // Every tick is a round number a reader can hold in their head.
    s!.ticks.forEach((t) => expect(Number.isInteger(t * 100)).toBe(true));
    expect(s!.ticks[0]).toBe(s!.min);
    expect(s!.ticks[s!.ticks.length - 1]).toBe(s!.max);
  });

  it('produces evenly spaced ticks', () => {
    const s = niceScale([0, 4551.3], { zeroBased: true })!;
    const gaps = s.ticks.slice(1).map((t, i) => t - s.ticks[i]);
    gaps.forEach((g) => expect(g).toBeCloseTo(gaps[0], 6));
  });

  it('anchors a bar axis at zero even when the data does not go near it', () => {
    // A bar's LENGTH is its value. Starting the axis at 1.2 makes a 1.26 kWh day look like
    // nothing and a 1.38 kWh day look like double it. This is the single most common way a
    // truthful dataset produces a dishonest picture.
    const s = niceScale([1.26, 1.38, 1.54], { zeroBased: true })!;
    expect(s.min).toBe(0);
  });

  it('lets a line chart breathe, because a line encodes position and not length', () => {
    const s = niceScale([220.1, 221.4, 219.8], { zeroBased: false })!;
    expect(s.min).toBeGreaterThan(0);
    expect(s.min).toBeLessThanOrEqual(219.8);
    expect(s.max).toBeGreaterThanOrEqual(221.4);
  });

  it('returns null rather than an axis when there is nothing to scale', () => {
    // The caller has to decide what "no data" looks like. Handing back a plausible 0–1 axis
    // would let a chart draw a confident empty grid over a month nobody observed.
    expect(niceScale([], { zeroBased: true })).toBeNull();
    expect(niceScale([null, null], { zeroBased: true })).toBeNull();
    expect(niceScale([Number.NaN, Number.POSITIVE_INFINITY], { zeroBased: true })).toBeNull();
  });

  it('ignores the gaps and scales to what was actually observed', () => {
    const s = niceScale([14.01, null, 21.83, null], { zeroBased: true })!;
    expect(s.max).toBeGreaterThanOrEqual(21.83);
  });

  it('still yields a usable axis when every observed value is identical', () => {
    // A flat series is real — a meter reading the same figure all month is a fact, not an
    // error — and a zero-height domain divides by zero two functions later.
    const s = niceScale([5, 5, 5], { zeroBased: false })!;
    expect(s.max).toBeGreaterThan(s.min);
  });

  it('handles an all-zero series without inventing a range', () => {
    const s = niceScale([0, 0], { zeroBased: true })!;
    expect(s.min).toBe(0);
    expect(s.max).toBeGreaterThan(0);
  });
});

describe('linearScale', () => {
  it('maps the domain ends onto the range ends', () => {
    const y = linearScale([0, 100], [200, 0]);
    expect(y(0)).toBe(200);
    expect(y(100)).toBe(0);
    expect(y(50)).toBe(100);
  });

  it('is inverted for y, so a bigger number is higher up the page', () => {
    const y = linearScale([0, 10], [120, 20]);
    expect(y(10)).toBeLessThan(y(1));
  });
});

describe('bandScale', () => {
  it('divides the range into non-overlapping bands', () => {
    const b = bandScale(9, [44, 512], 0.3);
    const bands = Array.from({ length: 9 }, (_, i) => b(i));
    bands.slice(1).forEach((band, i) => expect(band.x).toBeGreaterThanOrEqual(bands[i].x + bands[i].w));
    bands.forEach((band) => expect(band.w).toBeGreaterThan(0));
    expect(bands[0].x).toBeGreaterThanOrEqual(44);
    expect(bands[8].x + bands[8].w).toBeLessThanOrEqual(512);
  });

  it('keeps a single band inside the plot instead of filling it edge to edge', () => {
    const band = bandScale(1, [0, 100], 0.3)(0);
    expect(band.x).toBeGreaterThan(0);
    expect(band.w).toBeLessThan(100);
  });

  it('survives a count of zero without producing NaN geometry', () => {
    // A period with no days is not reachable today, but NaN in a `width` attribute is the kind
    // of thing that renders as an empty chart rather than an error.
    const b = bandScale(0, [0, 100], 0.3);
    expect(Number.isFinite(b(0).x)).toBe(true);
    expect(Number.isFinite(b(0).w)).toBe(true);
  });
});

describe('plotBox', () => {
  it('insets the drawing area by the margins', () => {
    const box = plotBox(520, 220, DEFAULT_MARGINS);
    expect(box.x).toBe(DEFAULT_MARGINS.left);
    expect(box.y).toBe(DEFAULT_MARGINS.top);
    expect(box.w).toBe(520 - DEFAULT_MARGINS.left - DEFAULT_MARGINS.right);
    expect(box.h).toBe(220 - DEFAULT_MARGINS.top - DEFAULT_MARGINS.bottom);
    expect(box.right).toBe(520 - DEFAULT_MARGINS.right);
    expect(box.bottom).toBe(220 - DEFAULT_MARGINS.bottom);
  });

  it('leaves room on the left for a y-axis label, which is where the numbers go', () => {
    expect(DEFAULT_MARGINS.left).toBeGreaterThan(DEFAULT_MARGINS.right);
  });
});
