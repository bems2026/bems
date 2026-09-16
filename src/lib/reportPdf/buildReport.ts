import {
  BASELINE_MIN_DAYS,
  BASELINE_MIN_SAMPLES,
  DEMAND_CAVEAT,
  NOT_A_BASELINE_TITLE,
  NOT_SAID,
  notABaselineYet,
} from '@shared/reportProse.mjs';
import { PRINT_PALETTE } from '@/components/reports/charts/palette';
import { sceneToSvg } from '@/components/reports/charts/sceneToSvg';
import { dailyEnergyChart } from '@/components/reports/charts/dailyEnergyChart';
import { loadProfileChart } from '@/components/reports/charts/loadProfileChart';
import { circuitBreakdownChart } from '@/components/reports/charts/circuitBreakdownChart';
import { demandHeatmapChart } from '@/components/reports/charts/demandHeatmapChart';
import { durationCurveChart } from '@/components/reports/charts/durationCurveChart';
import type { Scene } from '@/components/reports/charts/types';
import type { ChartsData } from '@/components/reports/ReportCharts';
import { toDailyPoints, toDurationPoints, toHeatCells, toHourPoints } from '@/lib/reportSeries';
import { coverageOf, formatPeriod, isQuotable, type PeriodBuildingReport, type PeriodDeviceReport, type ReportPeriod } from '@/lib/supabaseReports';
import { compare, describeDifference } from '@/lib/ipmvp';
import { provenanceLines, type Carboned, type Costed } from '@/lib/energyCost';
import { buildBreakdown } from '@/lib/circuitBreakdown';
import { energyFlagOf, energyFlagText, usableEnergy } from '@/lib/boundedEnergy';
import { normaliseSections, type ReportSectionId } from '@/lib/reportSections';
import { CONTENT_WIDTH, type PdfChart, type PdfDeviceRow, type PdfReport } from './docDefinition';

/**
 * Everything the document needs, assembled from what the page already holds — RM-083b.
 *
 * This lived inside `ExportPdfButton`, which made the document impossible to build for any choice
 * but "everything" and impossible to test without a component and a click. It is a pure function now:
 * the export drawer calls it with the sections a reader chose, and `docDefinition` turns the result
 * into pdfmake nodes. No pdfmake here either.
 *
 * THE CHARTS ARE GENERATED AGAIN, ON PURPOSE, and only the chosen ones. The page's copies are drawn
 * against `SCREEN_PALETTE`, whose values follow the theme toggle; these are drawn against
 * `PRINT_PALETTE`, because paper is white whatever the kiosk is set to. Each scene costs time on the
 * Pi, so a chart nobody asked for is not drawn and thrown away.
 */

export interface PdfReportInput {
  period: ReportPeriod;
  periodLabel: string;
  siteName: string;
  timezone: string;
  /** Already formatted in the building's own time. */
  generatedAt: string;
  buildId: string | null;
  building: PeriodBuildingReport | null;
  /** The stored period before this one, for the comparison section; `null` when there is none. */
  previous: PeriodBuildingReport | null;
  rows: readonly PeriodDeviceReport[];
  charts: ChartsData;
  cost: Costed;
  carbon: Carboned;
  nameOf: (id: string) => string;
  /** The branch meters whose sum is the building total — `BUILDING_METER_IDS` on the page. */
  meterIds: readonly string[];
  sections: readonly ReportSectionId[];
}

const f = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? null : v.toFixed(digits);

const watts = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${Math.round(v).toLocaleString(undefined)} W`;

const spec = (idPrefix: string, height: number, title: string) => ({
  width: CONTENT_WIDTH,
  height,
  palette: PRINT_PALETTE,
  idPrefix,
  title,
  desc: '',
});

/** One entry per chart, in the order the report reads: which section it is, and how to draw it and
 *  the numbers that travel with it. A printed chart cannot be hovered. */
const CHARTS: readonly {
  section: ReportSectionId;
  /** How the document names a chart it had to leave out. */
  label: string;
  /** Whether this chart's data arrived. A chart without it is named as left out, never drawn empty. */
  has: (c: ChartsData) => boolean;
  build: (c: ChartsData) => { scene: Scene; table: PdfChart['table'] };
}[] = [
  {
    section: 'dailyEnergy',
    label: 'Energy per day',
    has: () => true,
    build: (c) => ({
      scene: dailyEnergyChart(toDailyPoints(c.daily), spec('pdf-de', 220, 'Energy per day')),
      table: {
        headers: ['Day', 'Energy (kWh)', 'Peak (W)', 'Readings'],
        rows: c.daily.map((d) => [d.local_day, d.usable_sample_count > 0 ? f(d.energy_kwh) : null, f(d.peak_power_w, 0), `${d.usable_sample_count} of ${d.sample_count}`]),
      },
    }),
  },
  {
    section: 'hourProfile',
    label: 'Demand by hour of the day',
    has: (c) => c.hours !== null,
    build: (c) => ({
      scene: loadProfileChart(toHourPoints(c.hours ?? []), spec('pdf-lp', 210, 'Demand by hour of the day')),
      table: {
        headers: ['Hour', 'Samples', 'Median (W)', 'p95 (W)', 'Peak (W)'],
        rows: toHourPoints(c.hours ?? []).map((h) => [`${String(h.hour).padStart(2, '0')}:00`, String(h.n), f(h.p50, 0), f(h.p95, 0), f(h.max, 0)]),
      },
    }),
  },
  {
    section: 'breakdown',
    label: 'Where the energy went',
    has: () => true,
    build: (c) => ({
      scene: circuitBreakdownChart(c.segments, spec('pdf-cb', 100, 'Where the energy went'), { untracked: c.untracked }),
      table: { headers: ['Circuit', 'Energy (kWh)'], rows: c.segments.map((s) => [s.label, f(s.kwh)]) },
    }),
  },
  {
    section: 'heatmap',
    label: 'Demand by day and hour',
    has: (c) => c.matrix !== null,
    build: (c) => ({
      scene: demandHeatmapChart(toHeatCells(c.matrix ?? []), spec('pdf-hm', c.daily.length > 10 ? 300 : 190, 'Demand by day and hour')),
      // The heatmap's 744 cells are not a table anyone reads; the hour profile already carries the
      // per-hour numbers, so this one rolls up to the day.
      table: {
        headers: ['Day', 'Hours with readings'],
        rows: c.daily.map((d) => [
          d.local_day,
          String((c.matrix ?? []).filter((m) => m.local_day.slice(0, 10) === d.local_day.slice(0, 10) && m.usable_sample_count > 0).length),
        ]),
      },
    }),
  },
  {
    section: 'durationCurve',
    label: 'Load duration',
    has: (c) => c.curve !== null,
    build: (c) => ({
      scene: durationCurveChart(toDurationPoints(c.curve ?? []), spec('pdf-dc', 210, 'Load duration'), { thresholdW: c.ceilingW }),
      table: {
        headers: ['Share of period', 'At or above (W)'],
        rows: toDurationPoints(c.curve ?? [])
          .filter((_, i) => i % 10 === 0)
          .map((p) => [`${p.pct}%`, f(p.w, 0)]),
      },
    }),
  },
];

export function buildPdfReport(input: PdfReportInput): PdfReport {
  const { period, periodLabel, building, previous, rows, charts, cost, carbon, nameOf } = input;
  const sections = normaliseSections(input.sections);
  const buildingCoverage = building ? coverageOf(building.online_sample_count, building.expected_sample_count) : null;
  const qualified = !isQuotable(buildingCoverage);
  const summary = charts.summary ?? null;
  // RM-081's rule, carried into the document: a period with no real reading states no energy.
  const notObserved = summary?.usable_minutes === 0;

  const deviceRow = (r: PeriodDeviceReport): PdfDeviceRow => {
    const c = coverageOf(r.online_sample_count, r.expected_sample_count);
    const flag = energyFlagOf(r);
    return {
      name: nameOf(r.device_id),
      // RM-090: an impossible stored figure is an em dash with its reason, never a number.
      energyKwh: f(usableEnergy(r)),
      note: flag ? energyFlagText(flag) : null,
      peakW: f(r.peak_power_w, 0),
      avgW: f(r.avg_power_w, 0),
      coverage: c ? `${Math.round(c.ratio * 100)}%` : '—',
    };
  };

  const observedDays = charts.daily.filter((d) => d.usable_sample_count > 0).length;
  const completeDays = charts.daily.filter((d) => d.expected_samples > 0 && d.usable_sample_count / d.expected_samples >= 0.95).length;

  // The gate counts real readings and days that held one — never rows — exactly as BaselineReport does.
  const thin = summary === null || summary.usable_minutes < BASELINE_MIN_SAMPLES || observedDays < BASELINE_MIN_DAYS;

  const meters = new Set(input.meterIds);
  const { untracked } = buildBreakdown(rows, nameOf);

  let comparison: PdfReport['comparison'] = null;
  if (building && previous) {
    const result = compare({ baseline: previous, reporting: building });
    comparison = {
      heading: `${periodLabel} against ${formatPeriod(period, previous.period_start)}`,
      lines: result.comparable
        ? [
            `Baseline ${result.baselineKwh.toFixed(2)} kWh; reporting ${result.reportingKwh.toFixed(2)} kWh.`,
            describeDifference(result, period),
          ]
        : [`Not comparable: ${result.reason}`],
    };
  }

  return {
    title: 'Energy report',
    siteName: input.siteName,
    timezone: input.timezone,
    generatedAt: input.generatedAt,
    periodLabel,
    buildId: input.buildId,
    sections,
    summary,
    observedDays,
    completeDays,
    energyKwh: building?.energy_kwh ?? null,
    notObserved,
    keyFigures: building
      ? [
          {
            label: 'Peak demand',
            value:
              building.peak_total_power_w === null || notObserved
                ? '—'
                : `${(building.peak_total_power_w / 1000).toFixed(2)} kW${qualified ? ' (partial period)' : ''}`,
          },
          { label: 'Average voltage', value: f(building.avg_voltage, 1) === null ? '—' : `${f(building.avg_voltage, 1)} V` },
          {
            label: 'Commands',
            value: `${building.command_count} (${building.command_count_manual} manual, ${building.command_count_schedule} scheduled, ${building.command_count_autoshed} auto-shed)`,
          },
          { label: 'Anomalies', value: String(building.anomaly_count) },
        ]
      : [],
    // The same qualifier the energy carries. A figure qualified on screen and bare in the document is
    // worse than one that was never qualified at all.
    cost: cost.total === null ? null : { text: `${cost.total.toFixed(2)} ${cost.currency ?? ''}`.trim(), qualified },
    carbon: carbon.total === null ? null : { text: `${carbon.total.toFixed(1)} kgCO2e`, qualified },
    provenance: provenanceLines(cost, carbon),
    charts: CHARTS.filter((c) => sections.includes(c.section) && c.has(charts)).map((c) => {
      const { scene, table } = c.build(charts);
      return { section: c.section, title: scene.title, svg: sceneToSvg(scene, PRINT_PALETTE), desc: scene.desc, table };
    }),
    // RM-081b: a chosen chart whose data could not be read is named, so the document says what it
    // left out rather than silently being one chart shorter than the reader asked for.
    omitted: CHARTS.filter((c) => sections.includes(c.section) && !c.has(charts)).map((c) => c.label),
    deviceRows: rows.map(deviceRow),
    baseline: {
      gate: thin ? [NOT_A_BASELINE_TITLE, ...notABaselineYet(summary?.usable_minutes ?? 0, observedDays)] : null,
      rows: [
        ['Median (p50)', watts(summary?.p50_w)],
        ['p95', watts(summary?.p95_w)],
        ['p99', watts(summary?.p99_w)],
        ['Observed peak', watts(summary?.max_w)],
      ],
      caveat: DEMAND_CAVEAT,
    },
    circuits:
      rows.length === 0
        ? null
        : {
            branches: rows.filter((r) => meters.has(r.device_id)).map(deviceRow),
            devices: rows.filter((r) => !meters.has(r.device_id)).map(deviceRow),
            untracked:
              untracked && untracked.kwh !== null && untracked.kwh > 0
                ? `${untracked.kwh.toFixed(2)} kWh on ${untracked.label} is not attributable to any sub-meter beneath it.`
                : null,
          },
    comparison,
    caveats: NOT_SAID,
  };
}
