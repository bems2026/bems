import { describe, it, expect } from 'vitest';
import { hourlyEnergyChart, type HourlyEnergyPoint } from './hourlyEnergyChart';
import { PRINT_PALETTE } from './palette';
import type { ChartSpec, Mark } from './types';

/**
 * The daily chart's honesty rule, one day wide — RM-124. Twenty-four columns, always, from 00 to
 * 23: an hour nobody watched is a hatched gap, an hour that was watched and drew nothing is a
 * hairline, and an hour whose counter proved impossible (phase42 credited its measured power
 * instead) carries the open, dashed cap the daily chart uses for "at least this much".
 */

const SPEC: ChartSpec = {
  width: 520,
  height: 220,
  palette: PRINT_PALETTE,
  idPrefix: 'he',
  title: 'Hour by hour, Sat 19 Sep 2026',
  desc: 'A day.',
};

const hour = (h: number, over: Partial<HourlyEnergyPoint> = {}): HourlyEnergyPoint => ({
  hour: h,
  kwh: 0.5,
  observed: true,
  clipped: false,
  avgW: 500,
  maxW: 900,
  minutes: 60,
  ...over,
});
const day = (over: (h: number) => Partial<HourlyEnergyPoint> = () => ({})) => Array.from({ length: 24 }, (_, h) => hour(h, over(h)));

const rects = (marks: Mark[]) => marks.filter((m): m is Extract<Mark, { kind: 'rect' }> => m.kind === 'rect');
const texts = (marks: Mark[]) => marks.filter((m): m is Extract<Mark, { kind: 'text' }> => m.kind === 'text');
const lines = (marks: Mark[]) => marks.filter((m): m is Extract<Mark, { kind: 'line' }> => m.kind === 'line');
const bars = (marks: Mark[]) => rects(marks).filter((r) => r.fill !== 'url(#he-gap)');
const gaps = (marks: Mark[]) => rects(marks).filter((r) => r.fill === 'url(#he-gap)');

describe('hourlyEnergyChart', () => {
  it('draws one bar per observed hour and a gap for each run of unobserved ones', () => {
    // Observed 06:00–21:59, as a rehearsal day is; two outages, one at each end.
    const scene = hourlyEnergyChart(day((h) => (h < 6 || h > 21 ? { observed: false, kwh: null, minutes: 0 } : {})), SPEC);
    expect(bars(scene.marks)).toHaveLength(16);
    expect(gaps(scene.marks)).toHaveLength(2);
  });

  it('labels the axis in hours of the day, 00 first, and never renumbers when hours are missing', () => {
    const scene = hourlyEnergyChart(day((h) => (h === 3 ? { observed: false, kwh: null, minutes: 0 } : {})), SPEC);
    const labels = texts(scene.marks).map((t) => t.text).filter((t) => /^\d\d$/.test(t));
    expect(labels[0]).toBe('00');
    expect(labels).toContain('03');
    expect(labels).toContain('23');
  });

  it('thins the hour labels on a narrow chart rather than overlapping them, keeping 00', () => {
    const wide = hourlyEnergyChart(day(), SPEC);
    const narrow = hourlyEnergyChart(day(), { ...SPEC, width: 240 });
    const hours = (s: typeof wide) => texts(s.marks).map((t) => t.text).filter((t) => /^\d\d$/.test(t));
    expect(hours(wide)).toHaveLength(24);
    expect(hours(narrow).length).toBeLessThan(24);
    expect(hours(narrow)[0]).toBe('00');
  });

  it('distinguishes an hour that drew nothing from one nobody watched', () => {
    const scene = hourlyEnergyChart(day((h) => (h === 2 ? { kwh: 0, avgW: 0 } : h === 3 ? { observed: false, kwh: null, minutes: 0 } : {})), SPEC);
    expect(bars(scene.marks)).toHaveLength(23);
    expect(gaps(scene.marks)).toHaveLength(1);
    const hairline = bars(scene.marks).find((b) => b.h < 1);
    expect(hairline).toBeDefined();
  });

  it('caps a clipped hour with a dashed line and says why in its hit', () => {
    const scene = hourlyEnergyChart(day((h) => (h === 14 ? { clipped: true } : {})), SPEC);
    expect(lines(scene.marks).filter((l) => l.dash)).toHaveLength(1);
    const hit = scene.hits?.find((h) => h.label.startsWith('14:'));
    expect(hit?.note).toMatch(/counter/i);
  });

  it('gives a reader one hit per hour, named by the clock, valued in kWh with the average power', () => {
    const scene = hourlyEnergyChart(day((h) => (h === 5 ? { observed: false, kwh: null, minutes: 0 } : {})), SPEC);
    expect(scene.hits).toHaveLength(24);
    const ten = scene.hits?.[10];
    expect(ten?.label).toBe('10:00–10:59');
    expect(ten?.value).toBe('0.50 kWh');
    expect(ten?.note).toMatch(/500 W/);
    expect(scene.hits?.[5].value).toBe('No data');
  });

  it('anchors the axis at zero and lets only observed hours set the scale', () => {
    const scene = hourlyEnergyChart(day((h) => (h === 0 ? { observed: false, kwh: null, minutes: 0 } : { kwh: 1.2 })), SPEC);
    const ticks = texts(scene.marks).map((t) => t.text).filter((t) => /^\d+(\.\d)?$/.test(t) && !/^\d\d$/.test(t));
    expect(ticks).toContain('0');
  });

  it('says how many hours were not recorded, in the description', () => {
    const scene = hourlyEnergyChart(day((h) => (h < 6 ? { observed: false, kwh: null, minutes: 0 } : {})), SPEC);
    expect(scene.desc).toMatch(/6 of 24 hours were not recorded/);
  });

  it('draws nothing but a message when no hour was observed', () => {
    const scene = hourlyEnergyChart(day(() => ({ observed: false, kwh: null, minutes: 0 })), SPEC);
    expect(bars(scene.marks)).toHaveLength(0);
    expect(texts(scene.marks).some((t) => /nothing was recorded/i.test(t.text))).toBe(true);
  });

  it('namespaces every id it mints and is deterministic', () => {
    const a = hourlyEnergyChart(day((h) => (h === 1 ? { observed: false, kwh: null, minutes: 0 } : {})), SPEC);
    const b = hourlyEnergyChart(day((h) => (h === 1 ? { observed: false, kwh: null, minutes: 0 } : {})), SPEC);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    for (const d of a.defs) expect(d.id.startsWith('he-')).toBe(true);
  });
});

describe('an estimate, drawn so it cannot be read as a measurement — RM-130', () => {
  const est = { estimate: 'about two thirds of C.O Yellow' };

  it('hatches and outlines every bar, prefixes hits with ≈, and names the basis', () => {
    const scene = hourlyEnergyChart(day(), SPEC, est);
    const filled = rects(scene.marks).filter((r) => r.fill === 'url(#he-estimate)');
    expect(filled).toHaveLength(24);
    for (const r of filled) expect(r.fill).toBe('url(#he-estimate)');
    expect(filled.every((r) => r.stroke === PRINT_PALETTE.series[0])).toBe(true);
    expect(scene.hits?.[10].value).toBe('≈ 0.50 kWh');
    expect(scene.desc).toMatch(/Estimated, not metered: about two thirds/);
  });

  it('changes nothing when no estimate is declared', () => {
    expect(JSON.stringify(hourlyEnergyChart(day(), SPEC))).toBe(JSON.stringify(hourlyEnergyChart(day(), SPEC, {})));
  });
});
