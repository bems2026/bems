import { BASELINE_MIN_DAYS, BASELINE_MIN_SAMPLES, PLAIN_NOT_SAID, TOO_LITTLE_TITLE, tooLittleRecorded } from '@shared/reportProse.mjs';
import { PRINT_PALETTE } from '@/components/reports/charts/palette';
import { sceneToSvg } from '@/components/reports/charts/sceneToSvg';
import { dailyEnergyChart } from '@/components/reports/charts/dailyEnergyChart';
import { hourlyEnergyChart } from '@/components/reports/charts/hourlyEnergyChart';
import { loadProfileChart } from '@/components/reports/charts/loadProfileChart';
import { circuitBreakdownChart } from '@/components/reports/charts/circuitBreakdownChart';
import { demandHeatmapChart } from '@/components/reports/charts/demandHeatmapChart';
import { durationCurveChart } from '@/components/reports/charts/durationCurveChart';
import { circuitDailyEnergyChart, type CircuitDayPoint, type CircuitSeriesDef } from '@/components/reports/charts/circuitDailyEnergyChart';
import { circuitPowerTrendChart, type TrendDay, type TrendSeries } from '@/components/reports/charts/circuitPowerTrendChart';
import type { Scene } from '@/components/reports/charts/types';
import type { ChartsData } from '@/components/reports/ReportCharts';
import { toDailyPoints, toHourEnergyPoints, toDurationPoints, toHeatCells, toHourPoints } from '@/lib/reportSeries';
import { coverageOf, coverageRestatement, formatPeriod, isQuotable, type PeriodBuildingReport, type PeriodDeviceReport, type ReportPeriod } from '@/lib/supabaseReports';
import { compare, describeDifference } from '@/lib/ipmvp';
import { provenanceLines, type Carboned, type Costed } from '@/lib/energyCost';
import { buildBreakdown } from '@/lib/circuitBreakdown';
import { energyFlagOf, energyFlagText, usableEnergy } from '@/lib/boundedEnergy';
import { normaliseSections, type ReportDetail, type ReportSectionId } from '@/lib/reportSections';
import { CONTENT_WIDTH, type PdfChart, type PdfDeviceRow, type PdfReport } from './docDefinition';

/**
 * Everything the document needs, assembled from what the page already holds — RM-083b, in two depths and
 * narrowed to the part of the building chosen since RM-099.
 *
 * A pure function: the export drawer calls it with the sections and the depth a reader chose, and
 * `docDefinition` turns the result into pdfmake nodes. No pdfmake here.
 *
 * THE CHARTS ARE GENERATED AGAIN, ON PURPOSE, and only the chosen ones. The page's copies are drawn against
 * `SCREEN_PALETTE`, whose values follow the theme toggle; these are drawn against `PRINT_PALETTE`, because
 * paper is white whatever the kiosk is set to. Each scene costs time on the Pi, so a chart nobody asked for
 * is not drawn and thrown away.
 *
 * NARROWED TO A CATEGORY OR A CIRCUIT, the circuit charts and the circuit and device tables are that part
 * of the building; the building's own series stay the building's and say "(whole building)" in their
 * titles, so nobody files a building-wide chart believing it is Lighting's.
 */

export interface PdfCircuitInput {
  series: readonly CircuitSeriesDef[];
  /** `null` when the per-circuit days could not be read, or phase42 is not applied. */
  days: readonly CircuitDayPoint[] | null;
  /** RM-124: a day's per-circuit hours, in the same shape; `null` when they did not arrive. */
  hours?: readonly CircuitDayPoint[] | null;
  trend: { series: readonly TrendSeries[]; days: readonly TrendDay[] } | null;
}

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
  /** Every device row of the period. */
  rows: readonly PeriodDeviceReport[];
  /** The rows of the part of the building chosen — `rows` when it is the whole building. */
  scopedRows?: readonly PeriodDeviceReport[];
  charts: ChartsData;
  cost: Costed;
  carbon: Carboned;
  nameOf: (id: string) => string;
  /** The branch meters whose sum is the building total — `BUILDING_METER_IDS` on the page. */
  meterIds: readonly string[];
  sections: readonly ReportSectionId[];
  /** RM-099. Absent means Detailed, which is what every document was before. */
  detail?: ReportDetail;
  /** The category or circuit chosen, by name; `null` for the whole building. */
  scopeLabel?: string | null;
  circuits?: PdfCircuitInput | null;
}

const f = (v: number | null | undefined, digits = 2) => (v === null || v === undefined || !Number.isFinite(v) ? null : v.toFixed(digits));
const kw = (w: number | null | undefined) => (w === null || w === undefined || !Number.isFinite(w) ? '—' : `${(w / 1000).toFixed(2)} kW`);

const spec = (idPrefix: string, height: number, title: string) => ({
  width: CONTENT_WIDTH,
  height,
  palette: PRINT_PALETTE,
  idPrefix,
  title,
  desc: '',
});

interface ChartContext {
  charts: ChartsData;
  circuits: PdfCircuitInput | null;
  /** The branch meters whose hourly credits sum to the building's — RM-124. */
  meterIds: readonly string[];
  /** " (whole building)" when the document is narrowed, else empty. */
  building: string;
  /** " — Lighting" when the document is narrowed, else empty. */
  scope: string;
}

/** One entry per chart, in the order the report reads: which section it is, and how to draw it and the
 *  numbers that travel with it. A printed chart cannot be hovered. */
const CHARTS: readonly {
  section: ReportSectionId;
  /** How the document names a chart it had to leave out. */
  label: string;
  /** Whether this chart's data arrived. A chart without it is named as left out, never drawn empty. */
  has: (x: ChartContext) => boolean;
  build: (x: ChartContext) => { scene: Scene; table: PdfChart['table'] };
}[] = [
  {
    section: 'dailyEnergy',
    label: 'Energy per day',
    has: () => true,
    build: ({ charts: c, building }) => ({
      scene: dailyEnergyChart(toDailyPoints(c.daily), spec('pdf-de', 220, `Energy per day${building}`)),
      table: {
        headers: ['Day', 'Energy (kWh)', 'Highest (W)', 'Minutes recorded'],
        rows: c.daily.map((d) => [d.local_day, d.usable_sample_count > 0 ? f(d.energy_kwh) : null, f(d.peak_power_w, 0), String(d.usable_sample_count)]),
      },
    }),
  },
  {
    // RM-124: a day, hour by hour, as the sum of the building's branch meters.
    section: 'hourlyEnergy',
    label: 'Energy per hour',
    has: ({ charts: c }) => c.hourEnergy !== null && c.hourEnergy !== undefined,
    build: ({ charts: c, building, meterIds }) => {
      const meters = new Set(meterIds);
      const points = toHourEnergyPoints((c.hourEnergy ?? []).filter((r) => meters.has(r.device_id)));
      return {
        scene: hourlyEnergyChart(points, spec('pdf-he', 220, `Energy per hour${building}`)),
        table: {
          headers: ['Hour', 'Energy (kWh)', 'Average (W)', 'Minutes recorded'],
          rows: points.map((p) => [`${String(p.hour).padStart(2, '0')}:00`, p.observed && p.kwh !== null ? f(p.kwh) : null, f(p.avgW, 0), String(p.minutes)]),
        },
      };
    },
  },
  {
    section: 'useShare',
    label: 'Energy by use',
    has: ({ charts: c }) => (c.useSegments ?? []).length > 0,
    build: ({ charts: c, building }) => ({
      scene: circuitBreakdownChart(c.useSegments ?? [], spec('pdf-us', 100, `Energy by use${building}`), { of: 'uses' }),
      table: { headers: ['Use', 'Energy (kWh)'], rows: (c.useSegments ?? []).map((s) => [s.label, f(s.kwh)]) },
    }),
  },
  {
    section: 'circuitEnergy',
    label: 'Energy per day, by circuit',
    has: ({ circuits }) => circuits !== null && circuits.days !== null,
    build: ({ circuits, scope }) => {
      const days = circuits?.days ?? [];
      const series = circuits?.series ?? [];
      return {
        scene: circuitDailyEnergyChart(days, series, spec('pdf-cd', 240, `Energy per day, by circuit${scope}`)),
        table: { headers: ['Day', ...series.map((s) => `${s.label} (kWh)`)], rows: days.map((d) => [d.day, ...d.values.map((v) => f(v))]) },
      };
    },
  },
  {
    section: 'circuitHourly',
    label: 'Energy per hour, by circuit',
    has: ({ circuits }) => circuits !== null && circuits.hours !== null && circuits.hours !== undefined,
    build: ({ circuits, scope }) => {
      const hours = circuits?.hours ?? [];
      const series = circuits?.series ?? [];
      return {
        scene: circuitDailyEnergyChart(hours, series, spec('pdf-ch', 240, `Energy per hour, by circuit${scope}`)),
        table: { headers: ['Hour', ...series.map((s) => `${s.label} (kWh)`)], rows: hours.map((h) => [h.day, ...h.values.map((v) => f(v))]) },
      };
    },
  },
  {
    section: 'circuitTrend',
    label: 'Power through the period, by circuit',
    has: ({ circuits }) => circuits !== null && circuits.trend !== null,
    build: ({ circuits, scope }) => {
      const series = circuits?.trend?.series ?? [];
      const days = circuits?.trend?.days ?? [];
      const n = series[0]?.points.length ?? 0;
      return {
        scene: circuitPowerTrendChart(series, days, spec('pdf-ct', 240, `Power through the period, by circuit${scope}`)),
        table: {
          headers: ['Day', ...series.flatMap((s) => [`${s.label} average (W)`, `${s.label} highest (W)`])],
          rows: days.map((d, k) => {
            const to = days[k + 1]?.index ?? n;
            return [
              d.key,
              ...series.flatMap((s) => {
                const values = s.points.slice(d.index, to).filter((v): v is number => v !== null);
                return values.length === 0 ? [null, null] : [f(values.reduce((a, v) => a + v, 0) / values.length, 0), f(Math.max(...values), 0)];
              }),
            ];
          }),
        },
      };
    },
  },
  {
    section: 'hourProfile',
    label: 'A typical day, hour by hour',
    has: ({ charts: c }) => c.hours !== null,
    build: ({ charts: c, building }) => ({
      scene: loadProfileChart(toHourPoints(c.hours ?? []), spec('pdf-lp', 210, `A typical day, hour by hour${building}`)),
      table: {
        headers: ['Hour', 'Minutes recorded', 'Usual (W)', 'High (W)', 'Highest (W)'],
        rows: toHourPoints(c.hours ?? []).map((h) => [`${String(h.hour).padStart(2, '0')}:00`, String(h.n), f(h.p50, 0), f(h.p95, 0), f(h.max, 0)]),
      },
    }),
  },
  {
    section: 'breakdown',
    label: 'Each circuit’s share',
    has: () => true,
    build: ({ charts: c, building }) => ({
      scene: circuitBreakdownChart(c.segments, spec('pdf-cb', 100, `Each circuit’s share${building}`), { untracked: c.untracked }),
      table: { headers: ['Circuit', 'Energy (kWh)'], rows: c.segments.map((s) => [s.label, f(s.kwh)]) },
    }),
  },
  {
    section: 'heatmap',
    label: 'Busy hours',
    has: ({ charts: c }) => c.matrix !== null,
    build: ({ charts: c, building }) => ({
      scene: demandHeatmapChart(toHeatCells(c.matrix ?? []), spec('pdf-hm', c.daily.length > 10 ? 300 : 190, `Busy hours${building}`)),
      // 744 cells is not a table anyone reads; the typical day already carries the per-hour numbers.
      table: {
        headers: ['Day', 'Hours recorded'],
        rows: c.daily.map((d) => [
          d.local_day,
          String((c.matrix ?? []).filter((m) => m.local_day.slice(0, 10) === d.local_day.slice(0, 10) && m.usable_sample_count > 0).length),
        ]),
      },
    }),
  },
  {
    section: 'durationCurve',
    label: 'Time at each demand level',
    has: ({ charts: c }) => c.curve !== null,
    build: ({ charts: c, building }) => ({
      scene: durationCurveChart(toDurationPoints(c.curve ?? []), spec('pdf-dc', 210, `Time at each demand level${building}`), { thresholdW: c.ceilingW }),
      table: {
        headers: ['Share of time', 'Demand at or above (W)'],
        rows: toDurationPoints(c.curve ?? [])
          .filter((_, i) => i % 10 === 0)
          .map((p) => [`${p.pct}%`, f(p.w, 0)]),
      },
    }),
  },
];

export function buildPdfReport(input: PdfReportInput): PdfReport {
  const { period, periodLabel, building, previous, rows, charts, cost, carbon, nameOf } = input;
  const detail = input.detail ?? 'detailed';
  const scopeLabel = input.scopeLabel ?? null;
  const scopedRows = input.scopedRows ?? rows;
  const sections = normaliseSections(input.sections, detail, input.period);
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
      peakW: f(r.peak_power_w, 0),
      avgW: f(r.avg_power_w, 0),
      coverage: c ? `${Math.round(c.ratio * 100)}%` : '—',
      note: flag ? energyFlagText(flag) : null,
    };
  };

  const observedDays = charts.daily.filter((d) => d.usable_sample_count > 0).length;
  const completeDays = charts.daily.filter((d) => d.expected_samples > 0 && d.usable_sample_count / d.expected_samples >= 0.95).length;

  // The gate counts real readings and days that held one — never rows — exactly as the page does.
  const thin = summary === null || summary.usable_minutes < BASELINE_MIN_SAMPLES || observedDays < BASELINE_MIN_DAYS;

  const meters = new Set(input.meterIds);
  const { untracked } = buildBreakdown(rows, nameOf);

  let comparison: PdfReport['comparison'] = null;
  if (building && previous) {
    const result = compare({ baseline: previous, reporting: building });
    comparison = {
      heading: `${periodLabel} compared with ${formatPeriod(period, previous.period_start)}`,
      lines: result.comparable
        ? [`Earlier ${result.baselineKwh.toFixed(2)} kWh; this ${period} ${result.reportingKwh.toFixed(2)} kWh.`, describeDifference(result, period)]
        : [`Not comparable: ${result.reason}`],
    };
  }

  // Every figure the document corrected or refused, said once near the top — RM-090. A restated Recorded
  // share leads, because every other figure in the document is qualified by it — RM-073.
  const restated = building ? coverageRestatement(building) : null;
  const corrections = [
    ...(restated ? [restated.text] : []),
    ...scopedRows.flatMap((r) => {
      const flag = energyFlagOf(r);
      return flag ? [`${nameOf(r.device_id)}: ${energyFlagText(flag)}`] : [];
    }),
  ];

  const context: ChartContext = {
    charts,
    circuits: input.circuits ?? null,
    meterIds: input.meterIds,
    building: scopeLabel ? ' (whole building)' : '',
    scope: scopeLabel ? ` — ${scopeLabel}` : '',
  };

  return {
    title: 'Energy report',
    siteName: input.siteName,
    timezone: input.timezone,
    generatedAt: input.generatedAt,
    periodLabel,
    buildId: input.buildId,
    sections,
    detail,
    scopeLabel,
    corrections,
    summary,
    observedDays,
    completeDays,
    energyKwh: building?.energy_kwh ?? null,
    notObserved,
    keyFigures: building
      ? [
          {
            label: 'Highest demand',
            value: building.peak_total_power_w === null || notObserved ? '—' : `${(building.peak_total_power_w / 1000).toFixed(2)} kW${qualified ? ' (partial period)' : ''}`,
          },
          { label: 'Average voltage', value: f(building.avg_voltage, 1) === null ? '—' : `${f(building.avg_voltage, 1)} V` },
          {
            label: 'Commands',
            value: `${building.command_count} (${building.command_count_manual} by hand, ${building.command_count_schedule} scheduled, ${building.command_count_autoshed} auto-shed)`,
          },
          { label: 'Unusual readings', value: String(building.anomaly_count) },
        ]
      : [],
    // The same qualifier the energy carries. A figure qualified on screen and bare in the document is
    // worse than one that was never qualified at all.
    cost: cost.total === null ? null : { text: `${cost.total.toFixed(2)} ${cost.currency ?? ''}`.trim(), qualified },
    carbon: carbon.total === null ? null : { text: `${carbon.total.toFixed(1)} kgCO2e`, qualified },
    provenance: provenanceLines(cost, carbon),
    charts: CHARTS.filter((c) => sections.includes(c.section) && c.has(context)).map((c) => {
      const { scene, table } = c.build(context);
      return { section: c.section, title: scene.title, svg: sceneToSvg(scene, PRINT_PALETTE), desc: scene.desc, table };
    }),
    // RM-081b: a chosen chart whose data could not be read is named, so the document says what it left
    // out rather than silently being one chart shorter than the reader asked for.
    omitted: CHARTS.filter((c) => sections.includes(c.section) && !c.has(context)).map((c) => c.label),
    deviceRows: scopedRows.map(deviceRow),
    baseline: {
      gate: thin ? [TOO_LITTLE_TITLE, ...tooLittleRecorded(summary?.usable_minutes ?? 0, observedDays)] : null,
      rows: [
        ['Usual demand (half the time above, half below)', kw(summary?.p50_w)],
        ['High demand (above this only 1 minute in 20)', kw(summary?.p95_w)],
        ['Highest demand', kw(summary?.max_w)],
      ],
      caveat: 'These describe what the building drew while it was recorded. They are not a limit.',
    },
    circuits:
      scopedRows.length === 0
        ? null
        : {
            branches: scopedRows.filter((r) => meters.has(r.device_id)).map(deviceRow),
            devices: scopedRows.filter((r) => !meters.has(r.device_id)).map(deviceRow),
            untracked:
              untracked && untracked.kwh !== null && untracked.kwh > 0 && !scopeLabel
                ? `${untracked.kwh.toFixed(2)} kWh on ${untracked.label} is not accounted for by any device on it.`
                : null,
          },
    comparison,
    caveats: PLAIN_NOT_SAID,
  };
}
