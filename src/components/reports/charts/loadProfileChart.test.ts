import { describe, it, expect } from 'vitest';
import { loadProfileChart, type HourProfilePoint } from './loadProfileChart';
import { PRINT_PALETTE } from './palette';
import type { ChartSpec, Mark } from './types';

/**
 * Demand by hour of the building's own day.
 *
 * The rule that matters here is the one EX-102 already fixed once for the live 24h chart: an
 * unreporting hour must leave a GAP, not a flat line. Interpolating across it draws a smooth
 * curve through hours nobody observed — the most confident possible picture of the least
 * evidence — and the reader has no way to tell which part was measured.
 */

const SPEC: ChartSpec = {
  width: 515,
  height: 200,
  palette: PRINT_PALETTE,
  idPrefix: 'lp',
  title: 'Demand by hour',
  desc: '',
};

const hour = (h: number, over: Partial<HourProfilePoint> = {}): HourProfilePoint => ({
  hour: h,
  n: 60,
  p50: 100 + h * 10,
  p95: 400 + h * 20,
  max: 800 + h * 30,
  ...over,
});

const full = () => Array.from({ length: 24 }, (_, h) => hour(h));
const unobserved = (h: number) => hour(h, { n: 0, p50: null, p95: null, max: null });

const paths = (m: Mark[]) => m.filter((x): x is Extract<Mark, { kind: 'path' }> => x.kind === 'path');
const texts = (m: Mark[]) => m.filter((x): x is Extract<Mark, { kind: 'text' }> => x.kind === 'text');
const rects = (m: Mark[]) => m.filter((x): x is Extract<Mark, { kind: 'rect' }> => x.kind === 'rect');
/** The median line: stroked, not filled. */
const medianPath = (m: Mark[]) => paths(m).find((p) => p.stroke !== undefined && p.fill === 'none');

describe('loadProfileChart', () => {
  it('draws a median line across a fully observed day', () => {
    const scene = loadProfileChart(full(), SPEC);
    const line = medianPath(scene.marks);
    expect(line).toBeDefined();
    // One subpath: a single M at the start and no others.
    expect((line!.d.match(/M/g) ?? []).length).toBe(1);
  });

  it('breaks the line at an unobserved hour instead of drawing through it', () => {
    // The defect EX-102 fixed for the live chart, in the report's version: a curve interpolated
    // across hours nobody watched is the most confident possible picture of the least evidence.
    const points = full().map((p) => (p.hour === 12 ? unobserved(12) : p));
    const line = medianPath(loadProfileChart(points, SPEC).marks);
    expect((line!.d.match(/M/g) ?? []).length).toBe(2);
  });

  it('starts a new subpath for every separate run of observed hours', () => {
    const points = full().map((p) => ([3, 4, 5, 11, 18].includes(p.hour) ? unobserved(p.hour) : p));
    const line = medianPath(loadProfileChart(points, SPEC).marks);
    expect((line!.d.match(/M/g) ?? []).length).toBe(4);
  });

  it('marks the unobserved hours so the break has a reason', () => {
    const points = full().map((p) => (p.hour === 12 ? unobserved(12) : p));
    const scene = loadProfileChart(points, SPEC);
    // Plot-height hatches only. The key carries a hatch swatch of its own, and counting that as
    // a gap is how this assertion first came back with two columns for one dark hour.
    const hatched = rects(scene.marks).filter((r) => r.fill.startsWith('url(') && r.h > 20);
    expect(hatched).toHaveLength(1);
  });

  it('names its three series, because prose cannot say which one is the blue line', () => {
    const scene = loadProfileChart(full(), SPEC);
    const labels = texts(scene.marks).map((t) => t.text);
    expect(labels).toContain('median');
    expect(labels).toContain('p50–p95');
    expect(labels).toContain('peak');
    // And the hatch only earns a key when something is actually missing.
    expect(labels).not.toContain('no data');
    const withGap = loadProfileChart(full().map((p) => (p.hour === 5 ? unobserved(5) : p)), SPEC);
    expect(texts(withGap.marks).map((t) => t.text)).toContain('no data');
  });

  it('shades the p50-to-p95 spread rather than only drawing the median', () => {
    // A median alone says nothing about whether the hour was steady or spiky, and the spread is
    // what a load-shedding decision actually rests on.
    const scene = loadProfileChart(full(), SPEC);
    const band = paths(scene.marks).find((p) => p.fill !== undefined && p.fill !== 'none');
    expect(band).toBeDefined();
    expect(band!.d).toMatch(/Z$/);
  });

  it('plots the peak as its own series, not folded into the band', () => {
    // The peak is a single sample, not a percentile, and averaging it into a band would hide
    // exactly the excursion a DSM threshold is set against.
    const scene = loadProfileChart(full(), SPEC);
    expect(paths(scene.marks).length).toBeGreaterThanOrEqual(3);
  });

  it('labels the hours of the day, thinned so they do not collide', () => {
    const scene = loadProfileChart(full(), SPEC);
    const hourLabels = texts(scene.marks).filter((t) => /^\d{2}$/.test(t.text));
    expect(hourLabels.length).toBeGreaterThan(3);
    expect(hourLabels.length).toBeLessThanOrEqual(12);
  });

  it('scales to the observed values only', () => {
    // An unobserved hour must not pull the axis to zero and flatten everything else.
    const points = full().map((p) => (p.hour < 20 ? unobserved(p.hour) : p));
    const scene = loadProfileChart(points, SPEC);
    const ticks = texts(scene.marks).filter((t) => /^\d+$/.test(t.text) && Number(t.text) > 24);
    expect(ticks.length).toBeGreaterThan(0);
  });

  it('says nothing was observed rather than drawing an empty grid', () => {
    const scene = loadProfileChart(Array.from({ length: 24 }, (_, h) => unobserved(h)), SPEC);
    expect(medianPath(scene.marks)).toBeUndefined();
    expect(texts(scene.marks).some((t) => /nothing was observed/i.test(t.text))).toBe(true);
  });

  it('counts the unobserved hours in its description', () => {
    const points = full().map((p) => ([1, 2].includes(p.hour) ? unobserved(p.hour) : p));
    expect(loadProfileChart(points, SPEC).desc).toMatch(/2 of 24/);
  });

  it('is deterministic', () => {
    const points = full().map((p) => (p.hour === 7 ? unobserved(7) : p));
    expect(loadProfileChart(points, SPEC)).toEqual(loadProfileChart(points, SPEC));
  });

  it('namespaces its ids', () => {
    const points = full().map((p) => (p.hour === 7 ? unobserved(7) : p));
    const scene = loadProfileChart(points, SPEC);
    scene.defs.forEach((d) => expect(d.id.startsWith(`${SPEC.idPrefix}-`)).toBe(true));
  });
});
