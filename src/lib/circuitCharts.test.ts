import { describe, it, expect } from 'vitest';
import { BUILDING_METER_IDS } from '@shared/registry.mjs';
import { LOADS } from '@shared/circuits.mjs';
import { branchOptions } from './circuitBreakdown';
import { circuitDayPoints, circuitHourPoints, circuitRefs, loadShareSegments, trendChartInput } from './circuitCharts';
import type { DeviceDayRow } from './circuitSeries';
import type { HourEnergyRow } from './reportSeries';
import type { PeriodDeviceReport } from './supabaseReports';

/**
 * RM-095 — rows into chart inputs. Every circuit and meter here is read off the site's tree; the only
 * invented names are in the fixtures' own values.
 */

const meters = BUILDING_METER_IDS as readonly string[];

const dayRow = (device_id: string, local_day: string, o: Partial<DeviceDayRow> = {}): DeviceDayRow => ({
  device_id,
  local_day,
  energy_kwh: 1,
  counter_kwh: 1,
  removed_kwh: null,
  clipped_hours: 0,
  peak_power_w: 100,
  avg_power_w: 40,
  online_minutes: 1440,
  expected_minutes: 1440,
  resolution: 'minute',
  ...o,
});

describe('circuitRefs', () => {
  it('gives every branch its colour by its place on the panel, and keeps it when narrowed', () => {
    const all = circuitRefs({ kind: 'all' });
    expect(all.map((c) => c.meterId)).toEqual([...meters]);
    expect(all.map((c) => c.colourIndex)).toEqual(meters.map((_, i) => i));
    const last = all[all.length - 1];
    expect(circuitRefs({ kind: 'circuit', circuitId: last.id })).toEqual([last]);
  });
});

describe('circuitDayPoints', () => {
  const refs = circuitRefs({ kind: 'all' });

  it('lays out every day of the period with each circuit’s energy in panel order', () => {
    const rows = meters.flatMap((m, i) => [dayRow(m, '2026-09-07', { energy_kwh: i + 1 }), dayRow(m, '2026-09-08', { energy_kwh: 10 * (i + 1) })]);
    const points = circuitDayPoints(rows, refs);
    expect(points.map((p) => p.day)).toEqual(['2026-09-07', '2026-09-08']);
    expect(points.map((p) => p.label)).toEqual(['7', '8']);
    expect(points[1].values).toEqual(meters.map((_, i) => 10 * (i + 1)));
    expect(points.every((p) => p.observed && p.complete)).toBe(true);
  });

  it('leaves a circuit that recorded nothing that day empty, and a day nobody recorded unobserved', () => {
    const rows = meters.flatMap((m, i) => [
      dayRow(m, '2026-09-07', i === 0 ? { energy_kwh: null, online_minutes: 0 } : {}),
      dayRow(m, '2026-09-08', { energy_kwh: null, online_minutes: 0 }),
    ]);
    const [first, second] = circuitDayPoints(rows, refs);
    expect(first.values[0]).toBeNull();
    expect(first.observed).toBe(true);
    expect(first.complete).toBe(false);
    expect(second.observed).toBe(false);
  });

  it('calls a day partial when any circuit was only partly recorded', () => {
    const rows = meters.map((m, i) => dayRow(m, '2026-09-07', i === 1 ? { online_minutes: 700 } : {}));
    expect(circuitDayPoints(rows, refs)[0].complete).toBe(false);
  });

  it('carries a counter jump the day’s figure does not count, naming the circuit', () => {
    const rows = meters.map((m, i) => dayRow(m, '2026-09-08', i === meters.length - 1 ? { energy_kwh: 0.713, removed_kwh: 76.789 } : {}));
    expect(circuitDayPoints(rows, refs)[0].notes).toEqual([`${refs[refs.length - 1].label}: 76.79 kWh counter jump not counted`]);
  });
});

describe('trendChartInput', () => {
  it('starts a new day at each local midnight, in the building’s own offset', () => {
    // Local midnight at UTC+8 is 16:00 UTC; three local days of hours.
    const startMs = Date.parse('2026-09-06T16:00:00Z');
    const slots = Array.from({ length: 72 }, (_, h) => ({ startMs: startMs + h * 3_600_000, avgW: h === 30 ? null : 50, maxW: 60, online: 60, samples: 60 }));
    const refs = circuitRefs({ kind: 'all' }).slice(0, 1);
    const { series, days } = trendChartInput({ startMs, endMs: startMs + 72 * 3_600_000, series: [{ meterId: refs[0].meterId, slots }] }, refs, 480);
    expect(days).toEqual([
      { index: 0, label: '7', key: '2026-09-07' },
      { index: 24, label: '8', key: '2026-09-08' },
      { index: 48, label: '9', key: '2026-09-09' },
    ]);
    expect(series[0].points[30]).toBeNull();
    expect(series[0].colourIndex).toBe(refs[0].colourIndex);
  });

  it('draws a circuit the trend did not include as having no readings, not as a missing line', () => {
    const startMs = Date.parse('2026-09-06T16:00:00Z');
    const refs = circuitRefs({ kind: 'all' });
    const { series } = trendChartInput({ startMs, endMs: startMs + 3_600_000, series: [] }, refs, 480);
    expect(series).toHaveLength(refs.length);
    expect(series.every((s) => s.points.length === 1 && s.points[0] === null)).toBe(true);
  });
});

describe('loadShareSegments', () => {
  const row = (device_id: string, energy_kwh: number | null, o: Partial<PeriodDeviceReport> = {}): PeriodDeviceReport => ({
    period: 'week',
    period_start: '2026-09-07',
    device_id,
    energy_kwh,
    peak_power_w: 1000,
    avg_power_w: 100,
    online_sample_count: 10080,
    expected_sample_count: 10080,
    ...o,
  });

  it('sums the building meters by what their branches carry, in category order, never adding a sub-meter', () => {
    const rows = [...meters.map((m) => row(m, 10)), row('any-sub-meter', 99)];
    const segments = loadShareSegments(rows);
    expect(segments.map((s) => s.label)).toEqual(expect.arrayContaining(['Lighting', 'Aircon', 'Others']));
    expect(segments.reduce((a, s) => a + (s.kwh ?? 0), 0)).toBe(10 * meters.length);
    expect(segments.map((s) => s.colourIndex)).toEqual(segments.map((s) => (LOADS as readonly string[]).indexOf(s.id)));
  });

  it('leaves a category out of the sum, and says why, when one of its meters is impossible', () => {
    const lightingBranch = branchOptions()[0];
    expect(lightingBranch).toBeDefined();
    const rows = meters.map((m, i) => (i === 0 ? row(m, 81.406, { period: 'week', peak_power_w: 251.2 }) : row(m, 10)));
    const hit = loadShareSegments(rows).find((s) => s.excluded);
    expect(hit?.kwh).toBeNull();
    expect(hit?.excluded).toMatch(/could have drawn/);
  });
});

describe('circuitHourPoints — RM-124', () => {
  const refs = circuitRefs({ kind: 'all' });
  const hourRow = (device_id: string, local_hour: number, o: Partial<HourEnergyRow> = {}): HourEnergyRow => ({
    device_id,
    local_day: '2026-09-19',
    local_hour,
    energy_kwh: 0.1,
    clipped: false,
    avg_power_w: 100,
    max_power_w: 150,
    online_minutes: 60,
    resolution: 'minute',
    ...o,
  });

  it('lays out all twenty-four hours with each circuit’s energy in panel order, whatever hours the rows cover', () => {
    const rows = meters.flatMap((m, i) => [hourRow(m, 9, { energy_kwh: i + 1 }), hourRow(m, 10, { energy_kwh: 10 * (i + 1) })]);
    const points = circuitHourPoints(rows, refs);
    expect(points).toHaveLength(24);
    expect(points.map((p) => p.label).slice(0, 3)).toEqual(['00', '01', '02']);
    expect(points[9].day).toBe('09:00');
    expect(points[10].values).toEqual(meters.map((_, i) => 10 * (i + 1)));
    expect(points[10].observed && points[10].complete).toBe(true);
    expect(points[3].observed).toBe(false);
    expect(points[3].values.every((v) => v === null)).toBe(true);
  });

  it('calls an hour partial when any circuit recorded only part of it, and notes a clipped counter by name', () => {
    const rows = meters.map((m, i) => hourRow(m, 14, i === 0 ? { online_minutes: 20 } : i === 1 ? { clipped: true } : {}));
    const [p] = circuitHourPoints(rows, refs).filter((x) => x.day === '14:00');
    expect(p.complete).toBe(false);
    expect(p.notes?.some((n) => n.includes(refs[1].label) && /counter/i.test(n))).toBe(true);
  });
});
