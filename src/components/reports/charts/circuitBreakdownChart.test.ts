import { describe, it, expect } from 'vitest';
import { circuitBreakdownChart, type CircuitSegment } from './circuitBreakdownChart';
import { PRINT_PALETTE } from './palette';
import type { ChartSpec, Mark } from './types';

/**
 * Where the building's energy went, as a share of its own total.
 *
 * A 100% stacked bar is the honest form here and not merely a stylistic one: since RM-057 the
 * building total IS the sum of these four branch meters, so the parts really do make the whole
 * and a share really is a share. A pie of figures that did not sum would be a lie about
 * arithmetic; this one is exact by construction.
 *
 * The rule that matters: an unmetered circuit is NOT a zero-width segment. `l1`–`l7` have no
 * metering at all, and drawing them as slivers of nothing says the lights used no electricity.
 * They are excluded and named.
 */

const SPEC: ChartSpec = {
  width: 515,
  height: 130,
  palette: PRINT_PALETTE,
  idPrefix: 'cb',
  title: 'Where the energy went',
  desc: '',
};

const SEGMENTS: CircuitSegment[] = [
  { label: 'Convenience outlets', kwh: 45 },
  { label: 'Lighting', kwh: 25 },
  { label: 'Indoor ACU', kwh: 20 },
  { label: 'Outdoor ACU', kwh: 10 },
];

const rects = (m: Mark[]) => m.filter((x): x is Extract<Mark, { kind: 'rect' }> => x.kind === 'rect');
const texts = (m: Mark[]) => m.filter((x): x is Extract<Mark, { kind: 'text' }> => x.kind === 'text');
const bars = (m: Mark[]) => rects(m).filter((r) => r.h > 12);

describe('circuitBreakdownChart', () => {
  it('draws one segment per metered circuit', () => {
    expect(bars(circuitBreakdownChart(SEGMENTS, SPEC).marks)).toHaveLength(4);
  });

  it('sizes each segment by its share of the total', () => {
    const segs = bars(circuitBreakdownChart(SEGMENTS, SPEC).marks);
    // 45 : 25 : 20 : 10 — the first is exactly the sum of the last two plus a quarter more.
    expect(segs[0].w / segs[1].w).toBeCloseTo(45 / 25, 2);
    expect(segs[3].w / segs[0].w).toBeCloseTo(10 / 45, 2);
  });

  it('spans the full width, because the parts are the whole', () => {
    const segs = bars(circuitBreakdownChart(SEGMENTS, SPEC).marks);
    const total = segs.reduce((a, s) => a + s.w, 0);
    const span = segs[segs.length - 1].x + segs[segs.length - 1].w - segs[0].x;
    expect(total).toBeCloseTo(span, 1);
  });

  it('gives each circuit its own colour', () => {
    const fills = bars(circuitBreakdownChart(SEGMENTS, SPEC).marks).map((s) => s.fill);
    expect(new Set(fills).size).toBe(4);
  });

  it('excludes an unmetered circuit rather than drawing it as zero', () => {
    // The seven light switches carry no metering. A zero-width sliver says they used nothing.
    const withUnmetered = [...SEGMENTS, { label: 'Light switches', kwh: null }];
    const scene = circuitBreakdownChart(withUnmetered, SPEC);
    expect(bars(scene.marks)).toHaveLength(4);
    expect(scene.desc).toMatch(/Light switches/);
    expect(scene.desc).toMatch(/not metered/i);
  });

  it('labels a segment in place when it fits, and in a legend when it does not', () => {
    const lopsided: CircuitSegment[] = [
      { label: 'Convenience outlets', kwh: 97 },
      { label: 'Lighting', kwh: 1 },
      { label: 'Indoor ACU', kwh: 1 },
      { label: 'Outdoor ACU', kwh: 1 },
    ];
    const scene = circuitBreakdownChart(lopsided, SPEC);
    // The big one is named on the bar; the slivers are not, and get swatches instead.
    const swatches = rects(scene.marks).filter((r) => r.h <= 12);
    expect(swatches.length).toBeGreaterThanOrEqual(3);
    expect(texts(scene.marks).some((t) => t.text.includes('Convenience outlets'))).toBe(true);
  });

  it('shows each share as a percentage', () => {
    const scene = circuitBreakdownChart(SEGMENTS, SPEC);
    expect(texts(scene.marks).some((t) => /45(\.\d)?%/.test(t.text))).toBe(true);
  });

  it('says the total it is a breakdown of', () => {
    expect(circuitBreakdownChart(SEGMENTS, SPEC).desc).toMatch(/100(\.\d+)? kWh/);
  });

  it('reports an untracked remainder when one is given', () => {
    // Since RM-057 the building total IS the branch sum, so "building minus branches" is
    // structurally zero. The honest untracked figure is one level down: a branch minus the
    // sockets beneath it.
    const scene = circuitBreakdownChart(SEGMENTS, SPEC, { untracked: { label: 'Convenience outlets', kwh: 12 } });
    expect(scene.desc).toMatch(/12(\.\d+)? kWh/);
    expect(scene.desc).toMatch(/not attributable|unattributed|untracked/i);
  });

  it('says nothing was metered rather than drawing an empty bar', () => {
    const scene = circuitBreakdownChart([{ label: 'Lighting', kwh: null }], SPEC);
    expect(bars(scene.marks)).toHaveLength(0);
    expect(texts(scene.marks).some((t) => /nothing was metered/i.test(t.text))).toBe(true);
  });

  it('handles a total of zero without dividing by it', () => {
    const scene = circuitBreakdownChart([{ label: 'Lighting', kwh: 0 }, { label: 'Indoor ACU', kwh: 0 }], SPEC);
    scene.marks.forEach((m) =>
      Object.values(m).forEach((v) => {
        if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
      })
    );
  });

  it('is deterministic', () => {
    expect(circuitBreakdownChart(SEGMENTS, SPEC)).toEqual(circuitBreakdownChart(SEGMENTS, SPEC));
  });
});
