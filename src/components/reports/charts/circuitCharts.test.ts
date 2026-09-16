import { describe, it, expect } from 'vitest';
import { circuitDailyEnergyChart, type CircuitDayPoint } from './circuitDailyEnergyChart';
import { circuitPowerTrendChart, type TrendDay, type TrendSeries } from './circuitPowerTrendChart';
import { PRINT_PALETTE } from './palette';
import { sceneToSvg } from './sceneToSvg';
import type { ChartSpec, Mark } from './types';

/**
 * RM-095 — the branch circuits' own weekly and monthly charts, drawn as report scenes so the same
 * picture reaches the PDF.
 *
 * The rules they keep are the page's: a day nobody recorded is a hatched gap, never a zero bar; a
 * partly recorded day is "at least this much"; an hour with no reading breaks the line rather than
 * being drawn through; and a circuit keeps its colour whatever else is on the chart.
 */

const spec = (idPrefix: string, height = 240): ChartSpec => ({ width: 640, height, palette: PRINT_PALETTE, idPrefix, title: 'T', desc: '' });
const rects = (marks: Mark[]) => marks.filter((m): m is Extract<Mark, { kind: 'rect' }> => m.kind === 'rect');
const paths = (marks: Mark[]) => marks.filter((m): m is Extract<Mark, { kind: 'path' }> => m.kind === 'path');
const texts = (marks: Mark[]) => marks.filter((m): m is Extract<Mark, { kind: 'text' }> => m.kind === 'text').map((m) => m.text);

const SERIES = [
  { id: 'red', label: 'L.O Red', colourIndex: 0 },
  { id: 'yellow', label: 'L.O Yellow', colourIndex: 3 },
];

const day = (d: number, values: (number | null)[], o: Partial<CircuitDayPoint> = {}): CircuitDayPoint => ({
  day: `2026-09-${String(d).padStart(2, '0')}`,
  label: String(d),
  values,
  observed: values.some((v) => v !== null),
  complete: true,
  ...o,
});

describe('circuitDailyEnergyChart', () => {
  const week = [day(7, [0.19, 1.24]), day(8, [0.23, 0.71], { notes: ['L.O Yellow: 76.79 kWh counter jump not counted'] }), day(9, [null, null]), day(10, [0.11, 0.9], { complete: false })];

  it('stacks each day’s circuits, each in its own colour, in the order given', () => {
    const scene = circuitDailyEnergyChart(week, SERIES, spec('cd'));
    const fills = rects(scene.marks).filter((r) => !String(r.fill).startsWith('url(')).map((r) => r.fill);
    expect(fills.filter((f) => f === PRINT_PALETTE.series[0]).length).toBeGreaterThanOrEqual(3);
    expect(fills.filter((f) => f === PRINT_PALETTE.series[3]).length).toBeGreaterThanOrEqual(3);
  });

  it('keeps a circuit’s colour when its figures change, because colour follows the circuit, not its rank', () => {
    const swapped = week.map((p) => ({ ...p, values: [...p.values].reverse() }));
    const a = circuitDailyEnergyChart(week, SERIES, spec('cd'));
    const b = circuitDailyEnergyChart(swapped, SERIES, spec('cd'));
    const legend = (s: ReturnType<typeof circuitDailyEnergyChart>) => texts(s.marks).filter((t) => t.startsWith('L.O'));
    expect(legend(a)).toEqual(['L.O Red', 'L.O Yellow']);
    expect(legend(b)).toEqual(legend(a));
  });

  it('draws a day nothing was recorded on as a hatched gap, never a zero bar', () => {
    const scene = circuitDailyEnergyChart(week, SERIES, spec('cd'));
    // Plot-height blocks only: the legend carries a small swatch of the same hatch.
    expect(rects(scene.marks).filter((r) => String(r.fill).startsWith('url(#cd-gap') && r.h > 20).length).toBe(1);
    expect(scene.desc).toMatch(/1 of 4 days/);
  });

  it('says a partly recorded day is at least this much, with a broken top edge', () => {
    const scene = circuitDailyEnergyChart(week, SERIES, spec('cd'));
    expect(scene.marks.some((m) => m.kind === 'line' && m.dash)).toBe(true);
    const hit = (scene.hits ?? [])[3];
    expect(hit.value).toBe('1.01 kWh');
    expect(hit.note).toMatch(/at least/i);
  });

  it('reads each day’s total, each circuit, and what was taken out of it', () => {
    const hits = circuitDailyEnergyChart(week, SERIES, spec('cd')).hits ?? [];
    expect(hits.map((h) => h.label)).toEqual(['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10']);
    expect(hits[0]).toMatchObject({ value: '1.43 kWh' });
    expect(hits[0].note).toContain('L.O Red 0.19 kWh');
    expect(hits[1].note).toContain('76.79 kWh counter jump not counted');
    expect(hits[2].value).toBe('No data');
    // A full column, so a short stack is as easy to point at as a tall one.
    expect(new Set(hits.map((h) => h.h)).size).toBe(1);
  });

  it('says nothing was recorded rather than drawing an empty axis', () => {
    const scene = circuitDailyEnergyChart([day(9, [null, null])], SERIES, spec('cd'));
    expect(texts(scene.marks)).toContain('Nothing was recorded in this period');
    expect(scene.hits ?? []).toEqual([]);
  });

  it('prints the same picture it draws, with ids in its own namespace', () => {
    const scene = circuitDailyEnergyChart(week, SERIES, spec('cd'));
    const svg = sceneToSvg(scene, PRINT_PALETTE);
    expect(svg).toContain('id="cd-gap"');
    expect(sceneToSvg(scene, PRINT_PALETTE)).toBe(svg);
  });
});

describe('circuitPowerTrendChart', () => {
  // Two days of hours: the second circuit misses hours 5–7.
  const hours = 48;
  const series: TrendSeries[] = [
    { id: 'red', label: 'L.O Red', colourIndex: 0, points: Array.from({ length: hours }, (_, h) => 40 + (h % 24)) },
    { id: 'yellow', label: 'L.O Yellow', colourIndex: 3, points: Array.from({ length: hours }, (_, h) => (h >= 5 && h <= 7 ? null : 20)) },
  ];
  const days: TrendDay[] = [
    { index: 0, label: '7', key: '2026-09-07' },
    { index: 24, label: '8', key: '2026-09-08' },
  ];

  it('draws one line per circuit in its own colour, broken where an hour has no reading', () => {
    const scene = circuitPowerTrendChart(series, days, spec('ct'));
    const lines = paths(scene.marks);
    expect(lines.map((p) => p.stroke)).toEqual([PRINT_PALETTE.series[0], PRINT_PALETTE.series[3]]);
    expect((lines[0].d.match(/M/g) ?? []).length).toBe(1);
    expect((lines[1].d.match(/M/g) ?? []).length).toBe(2);
  });

  it('names the circuits in a legend, and each day under the axis', () => {
    const labels = texts(circuitPowerTrendChart(series, days, spec('ct')).marks);
    expect(labels).toEqual(expect.arrayContaining(['L.O Red', 'L.O Yellow', '7', '8']));
  });

  it('reads a day at a time: each circuit’s average and highest power', () => {
    const hits = circuitPowerTrendChart(series, days, spec('ct')).hits ?? [];
    expect(hits.map((h) => h.label)).toEqual(['2026-09-07', '2026-09-08']);
    expect(hits[0].value).toBe('Highest 63 W');
    expect(hits[0].note).toContain('L.O Red average 52 W, highest 63 W');
    expect(hits[0].note).toContain('L.O Yellow average 20 W, highest 20 W');
  });

  it('says nothing was recorded rather than drawing an axis for it', () => {
    const dark = series.map((s) => ({ ...s, points: s.points.map(() => null) }));
    const scene = circuitPowerTrendChart(dark, days, spec('ct'));
    expect(texts(scene.marks)).toContain('Nothing was recorded in this period');
    expect(paths(scene.marks)).toEqual([]);
  });
});
