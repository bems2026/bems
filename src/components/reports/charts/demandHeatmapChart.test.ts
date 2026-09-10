import { describe, it, expect } from 'vitest';
import { demandHeatmapChart, type HeatCell } from './demandHeatmapChart';
import { PRINT_PALETTE } from './palette';
import type { ChartSpec, Mark } from './types';

/**
 * Demand as a calendar: one cell per hour, days down, hours across.
 *
 * It is the fastest way to see that the aircon ran through a weekend, and the only chart here
 * where a coverage gap is visible as a shape rather than as a footnote.
 *
 * THE RULE THAT MATTERS: an unobserved cell must not be the lightest step of the ramp. The ramp
 * runs least-to-most, so the lightest step means "this hour drew almost nothing" — and 153 of
 * August 2026's 744 cells hold rows that carry no reading at all. Painting those the same colour
 * as a genuinely quiet hour turns two weeks of blindness into a picture of a calm building.
 */

const SPEC: ChartSpec = {
  width: 515,
  height: 260,
  palette: PRINT_PALETTE,
  idPrefix: 'hm',
  title: 'Demand by day and hour',
  desc: '',
};

const grid = (days: number, value: (d: number, h: number) => number | null): HeatCell[] =>
  Array.from({ length: days }, (_, d) =>
    Array.from({ length: 24 }, (_, h) => ({
      day: `2026-08-${String(d + 1).padStart(2, '0')}`,
      hour: h,
      value: value(d, h),
    }))
  ).flat();

const rects = (m: Mark[]) => m.filter((x): x is Extract<Mark, { kind: 'rect' }> => x.kind === 'rect');
const texts = (m: Mark[]) => m.filter((x): x is Extract<Mark, { kind: 'text' }> => x.kind === 'text');
/**
 * Cells are the grid squares. Identified as the largest group of identically sized rects rather
 * than by an aspect-ratio guess — the first version of this helper used one, and a 20x10 legend
 * swatch passed it, so every count came back five too high and the failure looked like the
 * implementation dropping cells.
 */
const cells = (m: Mark[]) => {
  const groups = new Map<string, Extract<Mark, { kind: 'rect' }>[]>();
  for (const r of rects(m)) {
    const key = `${r.w.toFixed(4)}x${r.h.toFixed(4)}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length)[0] ?? [];
};

describe('demandHeatmapChart', () => {
  it('draws a cell for every hour of every day', () => {
    const scene = demandHeatmapChart(grid(7, () => 500), SPEC);
    expect(cells(scene.marks).length).toBe(7 * 24);
  });

  it('handles a full month without dropping cells', () => {
    const scene = demandHeatmapChart(grid(31, () => 500), SPEC);
    expect(cells(scene.marks).length).toBe(744);
  });

  it('paints an unobserved cell outside the ramp, never as its lightest step', () => {
    // The lightest step means "this hour drew almost nothing". An hour nobody watched is a
    // different claim, and 153 of August's cells are exactly that.
    const scene = demandHeatmapChart(grid(2, (d, h) => (d === 0 && h === 0 ? null : 500)), SPEC);
    const ramp = new Set(PRINT_PALETTE.heat);
    const outside = cells(scene.marks).filter((c) => !ramp.has(c.fill));
    expect(outside).toHaveLength(1);
    expect(outside[0].fill).not.toBe(PRINT_PALETTE.heat[0]);
  });

  it('maps the lowest observed value to the lightest step and the highest to the darkest', () => {
    const scene = demandHeatmapChart(grid(1, (_d, h) => h * 100), SPEC);
    const row = cells(scene.marks);
    expect(row[0].fill).toBe(PRINT_PALETTE.heat[0]);
    expect(row[23].fill).toBe(PRINT_PALETTE.heat[PRINT_PALETTE.heat.length - 1]);
  });

  it('gives a legend, because a colour ramp without one is decoration', () => {
    const scene = demandHeatmapChart(grid(3, () => 500), SPEC);
    const swatches = rects(scene.marks).filter((r) => !cells(scene.marks).includes(r));
    expect(swatches.length).toBeGreaterThanOrEqual(PRINT_PALETTE.heat.length);
    // The ramp's ends are named in watts; a swatch strip with no numbers is still decoration.
    expect(texts(scene.marks).some((t) => /W$/.test(t.text))).toBe(true);
  });

  it('legends the hatch in words, but only when something is actually missing', () => {
    // A "no data" key on a period with no gaps is an invitation to look for one.
    const withGaps = demandHeatmapChart(grid(3, (_d, h) => (h === 0 ? null : 500)), SPEC);
    expect(texts(withGaps.marks).some((t) => /no data/i.test(t.text))).toBe(true);

    const complete = demandHeatmapChart(grid(3, () => 500), SPEC);
    expect(texts(complete.marks).some((t) => /no data/i.test(t.text))).toBe(false);
    expect(complete.defs).toHaveLength(0);
  });

  it('labels the hours across the top and the days down the side', () => {
    const scene = demandHeatmapChart(grid(7, () => 500), SPEC);
    expect(texts(scene.marks).some((t) => t.text === '00')).toBe(true);
    expect(texts(scene.marks).some((t) => t.text === '12')).toBe(true);
    // Day labels: the day of the month, not the whole ISO date.
    expect(texts(scene.marks).some((t) => t.text === '1')).toBe(true);
  });

  it('thins the day labels on a long month rather than overlapping them', () => {
    const scene = demandHeatmapChart(grid(31, () => 500), SPEC);
    const dayLabels = texts(scene.marks).filter((t) => t.anchor === 'end' && /^\d{1,2}$/.test(t.text));
    expect(dayLabels.length).toBeLessThan(31);
    expect(dayLabels.length).toBeGreaterThan(3);
  });

  it('counts the unobserved cells in its description', () => {
    const scene = demandHeatmapChart(grid(2, (_d, h) => (h < 4 ? null : 500)), SPEC);
    expect(scene.desc).toMatch(/8 of 48/);
  });

  it('says nothing was observed rather than drawing a blank grid', () => {
    const scene = demandHeatmapChart(grid(3, () => null), SPEC);
    expect(texts(scene.marks).some((t) => /nothing was observed/i.test(t.text))).toBe(true);
  });

  it('survives every cell holding the same value', () => {
    // A flat period is real, and a zero-width domain divides by zero when binning.
    const scene = demandHeatmapChart(grid(2, () => 500), SPEC);
    expect(cells(scene.marks)).toHaveLength(48);
    cells(scene.marks).forEach((c) => expect(PRINT_PALETTE.heat).toContain(c.fill));
  });

  it('is deterministic', () => {
    const g = grid(5, (d, h) => (h === 3 ? null : d * 100 + h));
    expect(demandHeatmapChart(g, SPEC)).toEqual(demandHeatmapChart(g, SPEC));
  });
});
