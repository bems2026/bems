import { describe, it, expect } from 'vitest';
import { durationCurveChart, type DurationPoint } from './durationCurveChart';
import { PRINT_PALETTE } from './palette';
import type { ChartSpec, Mark } from './types';

/**
 * The load duration curve: demand sorted high to low across the period.
 *
 * It answers the one question a single peak figure cannot — how LONG the building sits near its
 * maximum. A peak touched for twenty minutes a month and one held every afternoon are the same
 * number and completely different problems, and a load-shedding tier is an answer to the second.
 * Drawing the DSM threshold on it is what turns the chart into that argument.
 */

const SPEC: ChartSpec = {
  width: 515,
  height: 200,
  palette: PRINT_PALETTE,
  idPrefix: 'dc',
  title: 'Load duration',
  desc: '',
};

/** 101 points falling from `peak` to `floor`, the shape the RPC returns. */
const curve = (peak = 4551, floor = 5): DurationPoint[] =>
  Array.from({ length: 101 }, (_, i) => ({ pct: i, w: peak - (peak - floor) * (i / 100) }));

const paths = (m: Mark[]) => m.filter((x): x is Extract<Mark, { kind: 'path' }> => x.kind === 'path');
const lines = (m: Mark[]) => m.filter((x): x is Extract<Mark, { kind: 'line' }> => x.kind === 'line');
const texts = (m: Mark[]) => m.filter((x): x is Extract<Mark, { kind: 'text' }> => x.kind === 'text');

describe('durationCurveChart', () => {
  it('draws the curve', () => {
    const scene = durationCurveChart(curve(), SPEC);
    expect(paths(scene.marks).length).toBeGreaterThan(0);
  });

  it('draws the DSM threshold as a dashed rule, labelled', () => {
    const scene = durationCurveChart(curve(), { ...SPEC }, { thresholdW: 3000 });
    const dashed = lines(scene.marks).filter((l) => l.dash !== undefined);
    expect(dashed).toHaveLength(1);
    // Digits only. The label groups thousands with the READER's separator, not a fixed one
    // (RM-033's rule, and `test/site-naming.test.mjs` enforces it) — so asserting "3,000" here
    // would pass on this machine and fail on a French one for no defect at all.
    expect(texts(scene.marks).some((t) => t.text.replace(/\D/g, '').includes('3000'))).toBe(true);
  });

  it('says how much of the period sat above the threshold', () => {
    // The figure the chart exists to produce. Half the samples above 2278 W on a linear ramp.
    const scene = durationCurveChart(curve(4551, 5), SPEC, { thresholdW: 2278 });
    expect(scene.desc).toMatch(/5[01](\.\d)?%/);
  });

  it('omits the threshold entirely when none is configured', () => {
    // Not a zero line, not a placeholder: an unset threshold is not a threshold of nothing.
    const scene = durationCurveChart(curve(), SPEC);
    expect(lines(scene.marks).filter((l) => l.dash !== undefined)).toHaveLength(0);
    expect(scene.desc).not.toMatch(/threshold/i);
  });

  it('says so when the threshold was never reached', () => {
    const scene = durationCurveChart(curve(4551, 5), SPEC, { thresholdW: 9000 });
    expect(scene.desc).toMatch(/never/i);
    // And the rule is still drawn, above the curve, because "we never got near it" is the point.
    expect(lines(scene.marks).filter((l) => l.dash !== undefined)).toHaveLength(1);
  });

  it('scales the y axis to include the threshold, so an unreached one is still visible', () => {
    const scene = durationCurveChart(curve(1000, 5), SPEC, { thresholdW: 4000 });
    const rule = lines(scene.marks).find((l) => l.dash !== undefined)!;
    const axisLabels = texts(scene.marks).filter((t) => t.anchor === 'end');
    expect(axisLabels.length).toBeGreaterThan(1);
    // Inside the plot, not clipped off the top.
    expect(rule.y1).toBeGreaterThan(0);
    expect(rule.y1).toBeLessThan(SPEC.height);
  });

  it('anchors the axis at zero, because the area under the curve is energy', () => {
    const scene = durationCurveChart(curve(1000, 900), SPEC);
    expect(texts(scene.marks).some((t) => t.text === '0')).toBe(true);
  });

  it('labels the x axis as a share of the period, not as a sample index', () => {
    const scene = durationCurveChart(curve(), SPEC);
    expect(texts(scene.marks).some((t) => /%$/.test(t.text))).toBe(true);
  });

  it('says nothing was observed rather than drawing an empty grid', () => {
    const scene = durationCurveChart([], SPEC);
    expect(paths(scene.marks)).toHaveLength(0);
    expect(texts(scene.marks).some((t) => /nothing was observed/i.test(t.text))).toBe(true);
  });

  it('ignores points the series could not compute', () => {
    // percentile_cont returns NULL for a window with no samples at that fraction.
    const withHoles = curve().map((p, i) => (i % 10 === 0 ? { ...p, w: null } : p));
    const scene = durationCurveChart(withHoles, SPEC);
    expect(paths(scene.marks).length).toBeGreaterThan(0);
    scene.marks.forEach((m) =>
      Object.values(m).forEach((v) => {
        if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
      })
    );
  });

  it('is deterministic', () => {
    const c = curve();
    expect(durationCurveChart(c, SPEC, { thresholdW: 2000 })).toEqual(durationCurveChart(c, SPEC, { thresholdW: 2000 }));
  });
});
