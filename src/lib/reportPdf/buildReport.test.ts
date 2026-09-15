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

  it('carries the chosen sections, with coverage and the refusals put back', () => {
    const report = buildPdfReport(input({ sections: ['devices'] }));
    expect(report.sections).toEqual(['coverage', 'devices', 'notSaid']);
  });

  it('states a period with no real reading as not observed, and its peak as missing', () => {
    const report = buildPdfReport(input({ charts: { ...input().charts, summary: summary({ usable_minutes: 0 }) } }));
    expect(report.notObserved).toBe(true);
    expect(report.keyFigures?.find((k) => k.label === 'Peak demand')?.value).toBe('—');
  });

  it('qualifies the peak when the period was not fully observed', () => {
    const report = buildPdfReport(input({ building: building({ online_sample_count: Math.round(FULL * 0.4) }) }));
    expect(report.keyFigures?.find((k) => k.label === 'Peak demand')?.value).toBe('2.14 kW (partial period)');
  });

  it('gates a thin window as not a baseline yet, ahead of its numbers', () => {
    const thin = buildPdfReport(input({ charts: { ...input().charts, summary: summary({ usable_minutes: 500 }) } }));
    expect(thin.baseline?.gate?.length).toBeGreaterThan(0);
    expect(thin.baseline?.rows.map(([label]) => label)).toContain('Median (p50)');

    const full = buildPdfReport(input({ charts: { ...input().charts, daily: Array.from({ length: 5 }, (_, i) => dailyRow(i)) } }));
    expect(full.baseline?.gate).toBeNull();
  });

  it('separates the branch meters from the devices inside them, and never invents a device figure', () => {
    const report = buildPdfReport(input());
    expect(report.circuits?.branches.map((b) => b.name)).toEqual(['meter_a']);
    expect(report.circuits?.devices.map((d) => d.name)).toEqual(['dev_a']);
    expect(report.circuits?.devices[0].energyKwh).toBeNull();
  });

  it('compares with the previous period when both were fully observed', () => {
    const report = buildPdfReport(input({ previous: building({ period_start: '2026-07-01', energy_kwh: 120 }) }));
    expect(report.comparison?.heading).toMatch(/August 2026 against July 2026/);
    expect(report.comparison?.lines.join(' ')).toMatch(/20\.00 kWh \(16\.7%\) less/);
  });

  it('says why a comparison is refused rather than printing a difference', () => {
    const report = buildPdfReport(input({ previous: building({ period_start: '2026-07-01', energy_kwh: 120, online_sample_count: Math.round(FULL * 0.48) }) }));
    expect(report.comparison?.lines.join(' ')).toMatch(/Not comparable/);
    expect(report.comparison?.lines.join(' ')).toMatch(/48%/);
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
