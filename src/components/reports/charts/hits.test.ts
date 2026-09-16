import { describe, it, expect } from 'vitest';
import { dailyEnergyChart, type DailyEnergyPoint } from './dailyEnergyChart';
import { loadProfileChart, type HourProfilePoint } from './loadProfileChart';
import { circuitBreakdownChart } from './circuitBreakdownChart';
import { demandHeatmapChart, type HeatCell } from './demandHeatmapChart';
import { durationCurveChart } from './durationCurveChart';
import { sceneToSvg } from './sceneToSvg';
import { PRINT_PALETTE } from './palette';
import type { ChartSpec, Mark } from './types';

/**
 * RM-084 — what a reader can point at on each chart.
 *
 * Every generator emits hits: one per thing a value belongs to, sized to the column or cell rather
 * than the mark, carrying the value as text. And none of it may reach the PDF — the document cannot
 * be hovered, so the SVG it embeds must be exactly what it was before hits existed.
 */

const spec = (idPrefix: string, height = 200): ChartSpec => ({ width: 400, height, palette: PRINT_PALETTE, idPrefix, title: 'T', desc: '' });

describe('daily energy', () => {
  const points: DailyEnergyPoint[] = [
    { day: '2026-08-17', label: '17', kwh: 14.68, observed: true, complete: true },
    { day: '2026-08-18', label: '18', kwh: 0, observed: false, complete: false },
    { day: '2026-08-19', label: '19', kwh: 0.89, observed: true, complete: false },
  ];

  it('offers one hit per day, left to right, each a full-height column rather than just the bar', () => {
    const scene = dailyEnergyChart(points, spec('d'));
    const hits = scene.hits ?? [];
    expect(hits.map((h) => h.label)).toEqual(['2026-08-17', '2026-08-18', '2026-08-19']);
    expect(hits[1].x).toBeGreaterThan(hits[0].x);
    // The same height for every day: a short bar is as easy to point at as a tall one.
    expect(new Set(hits.map((h) => h.h)).size).toBe(1);
    expect(hits[0].h).toBeGreaterThan(0);
  });

  it('reads the energy for an observed day, "No data" for a day nobody watched, and qualifies a partial one', () => {
    const hits = dailyEnergyChart(points, spec('d')).hits ?? [];
    expect(hits[0].value).toBe('14.68 kWh');
    expect(hits[0].note).toBeUndefined();
    expect(hits[1].value).toBe('No data');
    expect(hits[2].value).toBe('0.89 kWh');
    expect(hits[2].note).toMatch(/at least/i);
  });

  it('offers nothing to point at when nothing was observed', () => {
    const dark = points.map((p) => ({ ...p, observed: false }));
    expect(dailyEnergyChart(dark, spec('d')).hits ?? []).toEqual([]);
  });
});

describe('load profile', () => {
  const hours: HourProfilePoint[] = Array.from({ length: 24 }, (_, hour) =>
    hour === 3 ? { hour, n: 0, p50: null, p95: null, max: null } : { hour, n: 30, p50: 400 + hour, p95: 900, max: 1500 }
  );

  it('offers one hit per hour, the usual demand first, with high and highest in the note', () => {
    const hits = loadProfileChart(hours, spec('h', 220)).hits ?? [];
    expect(hits).toHaveLength(24);
    expect(hits[0].label).toBe('00:00');
    expect(hits[0].value).toBe('Usual 400 W');
    expect(hits[0].note).toBe('high 900 W · highest 1,500 W'.replace('1,500', (1500).toLocaleString(undefined)));
    expect(hits[3].value).toBe('No data');
  });
});

describe('circuit breakdown', () => {
  it('offers one hit per metered circuit, covering exactly its segment', () => {
    const scene = circuitBreakdownChart(
      [
        { label: 'Outlets', kwh: 60 },
        { label: 'Aircon', kwh: 40 },
        { label: 'Lighting', kwh: null },
      ],
      spec('b', 100)
    );
    const hits = scene.hits ?? [];
    expect(hits.map((h) => h.label)).toEqual(['Outlets', 'Aircon']);
    expect(hits[0].value).toBe('60.0 kWh');
    expect(hits[0].note).toBe('60.0% of the metered total');
    const segment = scene.marks.find((m): m is Extract<Mark, { kind: 'rect' }> => m.kind === 'rect') as Extract<Mark, { kind: 'rect' }>;
    expect(hits[0].x).toBeCloseTo(segment.x, 6);
    expect(hits[0].w).toBeCloseTo(segment.w, 6);
  });
});

describe('demand heatmap', () => {
  it('offers one hit per cell, naming its day and hour, and no value where nothing was read', () => {
    const cells: HeatCell[] = [
      { day: '2026-08-17', hour: 9, value: 812.4 },
      { day: '2026-08-17', hour: 10, value: null },
    ];
    const hits = demandHeatmapChart(cells, spec('m')).hits ?? [];
    expect(hits).toHaveLength(2);
    expect(hits[0].label).toBe('2026-08-17 09:00');
    expect(hits[0].value).toBe('812 W average');
    expect(hits[1].value).toBe('No data');
  });
});

describe('duration curve', () => {
  it('offers a hit per computed point and none where the series broke', () => {
    const points = [
      { pct: 0, w: 4551.3 },
      { pct: 50, w: null },
      { pct: 100, w: 5.3 },
    ];
    const hits = durationCurveChart(points, spec('c', 220)).hits ?? [];
    expect(hits.map((h) => h.label)).toEqual(['0% of the time', '100% of the time']);
    expect(hits[0].value).toBe(`At or above ${(4551).toLocaleString(undefined)} W`);
  });
});

describe('the document', () => {
  it('embeds exactly the SVG it did before hits existed', () => {
    const scene = dailyEnergyChart(
      [
        { day: '2026-08-17', label: '17', kwh: 14.68, observed: true, complete: true },
        { day: '2026-08-18', label: '18', kwh: 0.5, observed: true, complete: false },
      ],
      spec('p')
    );
    expect(scene.hits?.length).toBeGreaterThan(0);
    const withHits = sceneToSvg(scene, PRINT_PALETTE);
    const without = sceneToSvg({ ...scene, hits: undefined }, PRINT_PALETTE);
    expect(withHits).toBe(without);
    // And no hit's words leaked in: a day's ISO date is a hit label, never a drawn one.
    expect(withHits).not.toContain('2026-08-17');
  });
});
