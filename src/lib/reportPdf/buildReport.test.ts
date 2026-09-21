import { describe, it, expect } from 'vitest';
import { buildPdfReport, type PdfReportInput } from './buildReport';
import type { PeriodBuildingReport, PeriodDeviceReport } from '@/lib/supabaseReports';
import type { DemandSummary } from '@/lib/reportSeries';

/**
 * RM-083b. Assembling the document moved out of `ExportPdfButton` into a pure function, so the export
 * drawer can build it for any choice of sections — and so what goes into a PDF is testable without a
 * component, a click or two megabytes of pdfmake.
 */

const FULL = 31 * 24 * 60;

const building = (o: Partial<PeriodBuildingReport> = {}): PeriodBuildingReport => ({
  period: 'month',
  period_start: '2026-08-01',
  energy_kwh: 100,
  peak_total_power_w: 2140,
  avg_voltage: 228.4,
  phase_current_red_avg: 2,
  phase_current_yellow_avg: 2,
  phase_current_blue_avg: null,
  command_count: 5,
  command_count_manual: 3,
  command_count_schedule: 2,
  command_count_autoshed: 0,
  anomaly_count: 1,
  online_sample_count: FULL,
  expected_sample_count: FULL,
  generated_at: '2026-09-03T00:00:00Z',
  ...o,
});

const summary = (o: Partial<DemandSummary> = {}): DemandSummary => ({
  n: FULL,
  p50_w: 800,
  p95_w: 1900,
  p99_w: 2100,
  max_w: 2140,
  min_w: 90,
  observed_minutes: FULL,
  usable_minutes: FULL,
  expected_minutes: FULL,
  longest_gap_minutes: 0,
  resolution: 'minute',
  ...o,
});

const device = (id: string, o: Partial<PeriodDeviceReport> = {}): PeriodDeviceReport => ({
  period: 'month',
  period_start: '2026-08-01',
  device_id: id,
  energy_kwh: 10,
  peak_power_w: 500,
  avg_power_w: 100,
  online_sample_count: FULL,
  expected_sample_count: FULL,
  ...o,
});

const input = (o: Partial<PdfReportInput> = {}): PdfReportInput => ({
  period: 'month',
  periodLabel: 'August 2026',
  siteName: 'A building',
  timezone: 'Asia/Manila',
  generatedAt: '15 September 2026, 10:00',
  buildId: null,
  building: building(),
  previous: null,
  rows: [device('meter_a', { energy_kwh: 60 }), device('dev_a', { energy_kwh: null })],
  charts: { daily: [], hours: [], matrix: [], curve: [], segments: [], ceilingW: null, summary: summary() },
  cost: { total: null, currency: null, byRate: [], unpricedKwh: 0, unobservedDays: 0, mixedCurrency: false },
  carbon: { total: null, byFactor: [], unpricedKwh: 0, unobservedDays: 0 },
  nameOf: (id) => id,
  meterIds: ['meter_a'],
  sections: ['keyFigures', 'dailyEnergy', 'heatmap', 'devices', 'baseline', 'circuits', 'comparison'],
  ...o,
});

describe('buildPdfReport', () => {
  it('draws only the charts whose sections were chosen', () => {
    // Each scene costs time on the Pi. A chart nobody asked for should not be drawn and discarded.
    const report = buildPdfReport(input({ sections: ['heatmap'] }));
    expect(report.charts.map((c) => c.section)).toEqual(['heatmap']);
  });

  it('leaves out a chart whose data could not be loaded, and names it rather than drawing it empty', () => {
    // Live, 2026-09-15: the duration curve's query timed out. An empty chart would read as a building
    // with no load; a missing one with no word would read as a chart the reader forgot to tick.
    const report = buildPdfReport(input({ sections: ['hourProfile', 'durationCurve'], charts: { ...input().charts, curve: null } }));
    expect(report.charts.map((c) => c.section)).toEqual(['hourProfile']);
    expect(report.omitted).toEqual(['Time at each demand level']);
  });

  it('carries the chosen sections, with coverage and the refusals put back', () => {
    const report = buildPdfReport(input({ sections: ['devices'] }));
    expect(report.sections).toEqual(['coverage', 'devices', 'notSaid']);
  });

  it('states a period with no real reading as not observed, and its peak as missing', () => {
    const report = buildPdfReport(input({ charts: { ...input().charts, summary: summary({ usable_minutes: 0 }) } }));
    expect(report.notObserved).toBe(true);
    expect(report.keyFigures?.find((k) => k.label === 'Highest demand')?.value).toBe('—');
  });

  it('qualifies the peak when the period was not fully observed', () => {
    const report = buildPdfReport(input({ building: building({ online_sample_count: Math.round(FULL * 0.4) }) }));
    expect(report.keyFigures?.find((k) => k.label === 'Highest demand')?.value).toBe('2.14 kW (partial period)');
  });

  it('gates a thin window as not a baseline yet, ahead of its numbers', () => {
    const thin = buildPdfReport(input({ charts: { ...input().charts, summary: summary({ usable_minutes: 500 }) } }));
    expect(thin.baseline?.gate?.length).toBeGreaterThan(0);
    expect(thin.baseline?.rows.map(([label]) => label).join(' ')).toMatch(/Usual demand/);
    expect(thin.baseline?.rows.map(([label]) => label).join(' ')).not.toMatch(/p50|p95|p99|median/i);

    const full = buildPdfReport(input({ charts: { ...input().charts, daily: Array.from({ length: 5 }, (_, i) => dailyRow(i)) } }));
    expect(full.baseline?.gate).toBeNull();
  });

  it('separates the branch meters from the devices inside them, and never invents a device figure', () => {
    const report = buildPdfReport(input());
    expect(report.circuits?.branches.map((b) => b.name)).toEqual(['meter_a']);
    expect(report.circuits?.devices.map((d) => d.name)).toEqual(['dev_a']);
    expect(report.circuits?.devices[0].energyKwh).toBeNull();
  });

  it('prints an impossible figure as a dash with its reason, and a corrected one with what was removed — RM-090', () => {
    const week = { period: 'week' as const, expected_sample_count: 10080 };
    const r = buildPdfReport(
      input({
        rows: [
          device('meter_a', { ...week, energy_kwh: 81.406, peak_power_w: 251.2 }),
          device('meter_b', { ...week, energy_kwh: 4.617, peak_power_w: 251.2, energy_removed_kwh: 76.789 }),
        ],
        meterIds: ['meter_a', 'meter_b'],
      })
    );
    expect(r.deviceRows[0]).toMatchObject({ energyKwh: null, note: expect.stringMatching(/^Not possible/) });
    expect(r.deviceRows[1]).toMatchObject({ energyKwh: '4.62', note: expect.stringMatching(/76.79 kWh/) });
  });

  it('compares with the previous period when both were fully observed', () => {
    const report = buildPdfReport(input({ previous: building({ period_start: '2026-07-01', energy_kwh: 120 }) }));
    expect(report.comparison?.heading).toMatch(/August 2026 compared with July 2026/);
    expect(report.comparison?.lines.join(' ')).toMatch(/20\.00 kWh \(16\.7%\) less/);
  });

  it('says why a comparison is refused rather than printing a difference', () => {
    const report = buildPdfReport(input({ previous: building({ period_start: '2026-07-01', energy_kwh: 120, online_sample_count: Math.round(FULL * 0.48) }) }));
    expect(report.comparison?.lines.join(' ')).toMatch(/Not comparable/);
    expect(report.comparison?.lines.join(' ')).toMatch(/48%/);
  });

  it('draws the circuit charts for the part chosen, and names the building’s own charts as the whole building — RM-099', () => {
    const report = buildPdfReport(
      input({
        sections: ['dailyEnergy', 'circuitEnergy', 'circuitTrend'],
        scopeLabel: 'Lighting',
        circuits: {
          series: [{ id: 'a', label: 'Lights A', colourIndex: 0 }],
          days: [{ day: '2026-08-01', label: '1', values: [1.2], observed: true, complete: true }],
          trend: null,
        },
      })
    );
    expect(report.charts.map((c) => c.title)).toEqual(['Energy per day (whole building)', 'Energy per day, by circuit — Lighting']);
    expect(report.omitted).toEqual(['Power through the period, by circuit']);
  });

  it('says a restated Recorded share first among the corrections, with what the report used to say — RM-073', () => {
    const report = buildPdfReport(
      input({
        building: building({ period: 'week', online_sample_count: 1640, expected_sample_count: 10080, online_sample_count_before: 9900, coverage_restated_at: '2026-09-17T06:00:00Z' }),
      })
    );
    expect(report.corrections?.[0]).toMatch(/^Recorded share corrected on .*: this report said 98%/);
  });

  it('keeps a Simple document to its own sections, and carries the corrections', () => {
    const week = { period: 'week' as const, expected_sample_count: 10080 };
    const report = buildPdfReport(
      input({
        detail: 'simple',
        sections: ['dailyEnergy', 'heatmap', 'devices'],
        rows: [device('meter_a', { ...week, energy_kwh: 4.617, peak_power_w: 251.2, energy_removed_kwh: 76.789 })],
      })
    );
    expect(report.sections).toEqual(['coverage', 'dailyEnergy', 'notSaid']);
    expect(report.corrections?.join(' ')).toMatch(/76\.79 kWh/);
  });

  it('uses no statistician’s words anywhere in the document it assembles — RM-097', () => {
    const report = buildPdfReport(input({ previous: building({ period_start: '2026-07-01', energy_kwh: 120 }) }));
    // What a reader sees: the figures' labels, the tables, the charts' titles and numbers, the comparison and
    // the limits — not the section ids or the summary's field names, which are code.
    const strings = (v: unknown): string[] =>
      typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];
    const words = strings({
      keyFigures: report.keyFigures,
      baseline: report.baseline,
      charts: report.charts.map((c) => ({ title: c.title, table: c.table })),
      omitted: report.omitted,
      comparison: report.comparison,
      caveats: report.caveats,
      corrections: report.corrections,
    }).join(' | ');
    expect(words).not.toMatch(/\bp(50|95|99)\b|median|baseline|DSM|load factor|load duration|percentile/i);
  });

  it('has no comparison when there is no earlier period to compare with', () => {
    expect(buildPdfReport(input()).comparison).toBeNull();
  });
});

function dailyRow(i: number) {
  return {
    local_day: `2026-08-${String(i + 1).padStart(2, '0')}`,
    energy_kwh: 3,
    peak_power_w: 2000,
    avg_power_w: 120,
    sample_count: 1440,
    usable_sample_count: 1440,
    expected_samples: 1440,
    first_seen_minute: 0,
    last_seen_minute: 1439,
    resolution: 'minute',
  };
}
describe('a day — RM-124', () => {
  const hourRow = (device_id: string, local_hour: number, energy_kwh: number | null) => ({
    device_id, local_day: '2026-09-19', local_hour, energy_kwh, clipped: false,
    avg_power_w: energy_kwh === null ? null : energy_kwh * 1000, max_power_w: null,
    online_minutes: energy_kwh === null ? 0 : 60, resolution: energy_kwh === null ? null : 'minute',
  });
  const day = (o: Partial<PdfReportInput> = {}) =>
    input({
      period: 'day',
      periodLabel: 'Sat, 19 Sep 2026',
      meterIds: ['m1', 'm2'],
      charts: { ...input().charts, hourEnergy: [...Array.from({ length: 24 }, (_, h) => hourRow('m1', h, h < 6 ? null : 0.5)), ...Array.from({ length: 24 }, (_, h) => hourRow('m2', h, h < 6 ? null : 0.1))] },
      ...o,
    });

  it('draws the day hour by hour, summing the building meters, in place of energy per day', () => {
    const report = buildPdfReport(day({ sections: ['dailyEnergy', 'hourlyEnergy'] }));
    expect(report.charts.map((c) => c.title)).toEqual(['Energy per hour']);
    const table = report.charts[0].table;
    expect(table.headers[0]).toBe('Hour');
    expect(table.rows).toHaveLength(24);
    expect(table.rows[10][1]).toBe('0.60');
    expect(table.rows[3][1]).toBeNull();
    // A one-bar "energy per day" is not drawn for a day, and is not reported as left out either.
    expect(report.omitted).toEqual([]);
  });

  it('draws each circuit hour by hour when the page hands it the hourly points', () => {
    const report = buildPdfReport(
      day({
        sections: ['circuitEnergy', 'circuitHourly'],
        scopeLabel: 'Lighting',
        circuits: {
          series: [{ id: 'a', label: 'Lights A', colourIndex: 0 }],
          days: null,
          hours: Array.from({ length: 24 }, (_, h) => ({ day: `${String(h).padStart(2, '0')}:00`, label: String(h).padStart(2, '0'), values: [0.04], observed: true, complete: true })),
          trend: null,
        },
      })
    );
    expect(report.charts.map((c) => c.title)).toEqual(['Energy per hour, by circuit — Lighting']);
    expect(report.omitted).toEqual([]);
  });

  it('names the hourly chart as left out when its rows did not arrive', () => {
    const report = buildPdfReport(day({ sections: ['hourlyEnergy'], charts: { ...input().charts, hourEnergy: null } }));
    expect(report.charts).toEqual([]);
    expect(report.omitted).toEqual(['Energy per hour']);
  });
});

describe('estimated loads — RM-130', () => {
  const coYellow = { period: 'month' as const, period_start: '2026-08-01', device_id: 'mtr_co_yellow', energy_kwh: 41.2, peak_power_w: 812, avg_power_w: 230, online_sample_count: 31 * 24 * 60, expected_sample_count: 31 * 24 * 60 };

  it('carries the director\'s aircon as an estimate of C.O Yellow, formatted with ≈ and its basis', () => {
    const report = buildPdfReport(input({ sections: ['apportioned'], rows: [coYellow], scopedRows: [coYellow] }));
    expect(report.sections).toContain('apportioned');
    expect(report.apportioned).toHaveLength(1);
    const [ac] = report.apportioned ?? [];
    expect(ac.label).toMatch(/director/i);
    expect(ac.branchLabel).toBe('C.O Yellow');
    expect(ac.share).toBe('about two thirds');
    expect(ac.estimated).toBe('≈ 27.47 kWh');
    expect(ac.remainder).toBe('≈ 13.73 kWh');
    expect(ac.branch).toBe('41.20 kWh');
    expect(ac.basis).toMatch(/2026-09-22/);
    expect(ac.note).toMatch(/would move ≈ 27\.47 kWh/);
  });

  it('is left out for a document narrowed to circuits that carry no estimate', () => {
    const lighting = { ...coYellow, device_id: 'mtr_lo_red', energy_kwh: 3.1 };
    const report = buildPdfReport(input({ sections: ['apportioned'], rows: [coYellow, lighting], scopedRows: [lighting], scopeLabel: 'Lighting' }));
    expect(report.apportioned).toEqual([]);
  });

  it('says a refused branch figure refuses its share too, and never prints a number for it', () => {
    const report = buildPdfReport(input({ sections: ['apportioned'], rows: [{ ...coYellow, energy_kwh: 981.4, peak_power_w: 251.2 }], scopedRows: [{ ...coYellow, energy_kwh: 981.4, peak_power_w: 251.2 }] }));
    const [ac] = report.apportioned ?? [];
    expect(ac.estimated).toMatch(/not possible/i);
    expect(ac.estimated).not.toMatch(/\d\.\d\d kWh/);
  });

  it('qualifies a partly recorded branch\'s estimate the way the page does', () => {
    const report = buildPdfReport(input({ sections: ['apportioned'], rows: [{ ...coYellow, online_sample_count: Math.round(31 * 24 * 60 * 0.6) }], scopedRows: [{ ...coYellow, online_sample_count: Math.round(31 * 24 * 60 * 0.6) }] }));
    const [ac] = report.apportioned ?? [];
    expect(ac.estimated).toMatch(/≈ 27\.47 kWh \(partial/);
  });
});
