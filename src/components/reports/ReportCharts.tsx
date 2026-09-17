import { useCallback, useMemo } from 'react';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { ChartFigure, type ChartTable } from './ChartFigure';
import { ChartPlaceholder } from './ReportSkeleton';
import { SCREEN_PALETTE } from './charts/palette';
import { dailyEnergyChart } from './charts/dailyEnergyChart';
import { loadProfileChart } from './charts/loadProfileChart';
import { demandHeatmapChart } from './charts/demandHeatmapChart';
import { durationCurveChart } from './charts/durationCurveChart';
import { circuitBreakdownChart, type CircuitSegment } from './charts/circuitBreakdownChart';
import type { Scene } from './charts/types';
import {
  toDailyPoints,
  toDurationPoints,
  toHeatCells,
  toHourPoints,
  type CurveRow,
  type DailyRow,
  type HourRow,
  type MatrixRow,
  type DemandSummary,
} from '@/lib/reportSeries';
import { formatPeriod, type ReportPeriod } from '@/lib/supabaseReports';
import { REPORT_CHART_WIDTH, reportChartHeight, type ReportChartKind } from '@/lib/reportChartSizes';

/**
 * The five charts, in the order the report reads.
 *
 * Shape before totals: a month's total says how much, and every one of these says something the
 * total cannot. Daily energy says which days; the load profile says which hours; the breakdown
 * says which circuits; the heatmap says which hours of which days, and makes an outage a shape;
 * the duration curve says how long the building sat near its ceiling, which is the only one of
 * the five that a load-shedding decision actually rests on.
 *
 * Every chart is generated with `SCREEN_PALETTE`, whose values are `var(--…)` — so they follow
 * the theme toggle with no code here. The PDF generates the same scenes against `PRINT_PALETTE`,
 * because paper is white.
 *
 * EACH CHART IS BUILT INSIDE ITS OWN ERROR BOUNDARY — RM-081. The five scenes used to be generated
 * together in one `useMemo` at this level, so a single malformed row in the heatmap's input threw
 * past every chart to the page boundary and replaced the whole Reports page.
 *
 * AND EACH DRAWS FROM ITS OWN DATA — RM-081b. The hour profile, the heatmap and the duration curve
 * each arrive on their own. A chart whose series is still coming holds its place at its own shape;
 * one whose series failed is simply not drawn, and the page says so above the charts with a Retry.
 * Live on 2026-09-15 the curve's query timed out every time, and it no longer takes the two charts
 * beside it down with it.
 */

export interface ChartsData {
  daily: DailyRow[];
  /** `null` when this chart's series has not arrived, or could not be read. */
  hours: HourRow[] | null;
  matrix: MatrixRow[] | null;
  curve: CurveRow[] | null;
  segments: CircuitSegment[];
  /** The building by what each circuit carries — RM-096's "Energy by use". */
  useSegments?: CircuitSegment[];
  untracked?: { label: string; kwh: number | null };
  ceilingW: number | null;
  /** Carried in the same bundle because the PDF and the baseline report both need it beside
   *  these series — splitting it out would mean two things to keep in step for one period. */
  summary?: DemandSummary | null;
}

interface Props extends ChartsData {
  period: ReportPeriod;
  start: string;
  /** Plot width, in viewBox units — it scales to the card. The kiosk is 800 wide; the PDF asks for 515pt. */
  width?: number;
  /** Charts whose data is still on its way; each holds its place at its own aspect ratio. */
  loading?: Partial<Record<ReportChartKind, boolean>>;
  /** Which charts this tab draws — RM-096. Every building chart when absent. */
  only?: readonly ReportChartKind[];
}

const num = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined || !Number.isFinite(v) ? null : v.toFixed(digits);

/** `08:00` from a minute-of-day, or an em dash. Minutes, because that is what the SQL returns —
 *  a day marked partial without saying WHICH hours it saw is a caveat nobody can act on. */
const hhmm = (m: number | null) =>
  m === null || m === undefined ? null : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const NONE: never[] = [];

interface SlotProps {
  /** What the chart is, as its fallback names it: "Energy per day could not be drawn". */
  scope: string;
  build: () => Scene;
  table: () => ChartTable;
  summaryLabel?: string;
}

/** Builds the scene and its table inside the boundary, which is the whole point of the split. */
function ChartBody({ build, table, summaryLabel }: Omit<SlotProps, 'scope'>) {
  const scene = useMemo(() => build(), [build]);
  const rows = useMemo(() => table(), [table]);
  return <ChartFigure scene={scene} table={rows} summaryLabel={summaryLabel} />;
}

function ChartSlot({ scope, build, table, summaryLabel }: SlotProps) {
  // `resetKey` is the builder, whose identity changes exactly when the data it draws does — so a
  // chart that failed on one period's rows tries again when the reader opens another.
  return (
    <ErrorBoundary scope={scope} variant="inline" resetKey={build}>
      <ChartBody build={build} table={table} summaryLabel={summaryLabel} />
    </ErrorBoundary>
  );
}

export function ReportCharts({
  period,
  start,
  daily,
  hours,
  matrix,
  curve,
  segments,
  useSegments = NONE,
  untracked,
  ceilingW,
  width = REPORT_CHART_WIDTH,
  loading = {},
  only = ['daily', 'hours', 'breakdown', 'heat', 'curve'],
}: Props) {
  const shows = (kind: ReportChartKind) => only.includes(kind);
  const label = formatPeriod(period, start);
  const hourRows = hours ?? NONE;
  const matrixRows = matrix ?? NONE;
  const curveRows = curve ?? NONE;

  const spec = useCallback(
    (idPrefix: string, height: number, title: string) => ({
      width,
      height,
      palette: SCREEN_PALETTE,
      idPrefix,
      title,
      desc: '',
    }),
    [width]
  );

  const dailyScene = useCallback(
    () => dailyEnergyChart(toDailyPoints(daily), spec('rep-de', reportChartHeight('daily', daily.length), `Energy per day — ${label}`)),
    [daily, spec, label]
  );
  const dailyTable = useCallback(
    (): ChartTable => ({
      headers: ['Day', 'Energy (kWh)', 'Highest (W)', 'Minutes recorded', 'Recorded between'],
      rows: daily.map((r) => [
        r.local_day,
        r.usable_sample_count > 0 ? num(r.energy_kwh, 2) : null,
        num(r.peak_power_w),
        // Rows and readings are different facts and the table shows both, because the
        // difference is the whole reason this column exists.
        r.usable_sample_count,
        r.first_seen_minute === null ? null : `${hhmm(r.first_seen_minute)}–${hhmm(r.last_seen_minute)}`,
      ]),
    }),
    [daily]
  );

  const hoursScene = useCallback(
    () => loadProfileChart(toHourPoints(hourRows), spec('rep-lp', reportChartHeight('hours', daily.length), `A typical day, hour by hour — ${label}`)),
    [hourRows, daily.length, spec, label]
  );
  const hoursTable = useCallback(
    (): ChartTable => ({
      headers: ['Hour', 'Minutes recorded', 'Usual (W)', 'High (W)', 'Highest (W)'],
      rows: toHourPoints(hourRows).map((h) => [`${String(h.hour).padStart(2, '0')}:00`, h.n, num(h.p50), num(h.p95), num(h.max)]),
    }),
    [hourRows]
  );

  const breakdownScene = useCallback(
    () => circuitBreakdownChart(segments, spec('rep-cb', reportChartHeight('breakdown', daily.length), `By circuit — ${label}`), { untracked }),
    [segments, untracked, daily.length, spec, label]
  );
  const breakdownTable = useCallback((): ChartTable => {
    const total = segments.reduce((a, x) => a + (x.kwh ?? 0), 0);
    return {
      headers: ['Circuit', 'Energy (kWh)', 'Share'],
      rows: segments.map((s) => [s.label, num(s.kwh, 2), s.kwh === null || total <= 0 ? null : `${((s.kwh / total) * 100).toFixed(1)}%`]),
    };
  }, [segments]);

  const useScene = useCallback(
    () => circuitBreakdownChart(useSegments, spec('rep-us', reportChartHeight('useShare', daily.length), `Energy by use — ${label}`)),
    [useSegments, daily.length, spec, label]
  );
  const useTable = useCallback((): ChartTable => {
    const total = useSegments.reduce((a, x) => a + (x.kwh ?? 0), 0);
    return {
      headers: ['Use', 'Energy (kWh)', 'Share'],
      rows: useSegments.map((s) => [s.label, num(s.kwh, 2), s.kwh === null || total <= 0 ? null : `${((s.kwh / total) * 100).toFixed(1)}%`]),
    };
  }, [useSegments]);

  const heatScene = useCallback(
    () => demandHeatmapChart(toHeatCells(matrixRows), spec('rep-hm', reportChartHeight('heat', daily.length), `Busy hours — ${label}`)),
    [matrixRows, daily.length, spec, label]
  );
  // 744 cells is not a table anyone reads. The per-hour numbers are already in the load profile
  // above; what this one adds is the shape, so its table is the daily roll-up.
  const heatTable = useCallback(
    (): ChartTable => ({
      headers: ['Day', 'Hours recorded', 'Busiest hour', 'Highest (W)'],
      rows: daily.map((r) => {
        const forDay = matrixRows.filter((c) => c.local_day.slice(0, 10) === r.local_day.slice(0, 10) && c.usable_sample_count > 0);
        const busiest = [...forDay].sort((a, b) => (b.avg_power_w ?? 0) - (a.avg_power_w ?? 0))[0];
        return [
          r.local_day,
          forDay.length,
          busiest ? `${String(busiest.local_hour).padStart(2, '0')}:00` : null,
          busiest ? num(busiest.max_power_w) : null,
        ];
      }),
    }),
    [daily, matrixRows]
  );

  const curveScene = useCallback(
    () => durationCurveChart(toDurationPoints(curveRows), spec('rep-dc', reportChartHeight('curve', daily.length), `Time at each demand level — ${label}`), { thresholdW: ceilingW }),
    [curveRows, ceilingW, daily.length, spec, label]
  );
  // Every tenth point: 101 rows of a smooth curve is noise, and the shape is the finding.
  const curveTable = useCallback(
    (): ChartTable => ({
      headers: ['Share of time', 'Demand at or above (W)'],
      rows: toDurationPoints(curveRows)
        .filter((_, i) => i % 10 === 0)
        .map((p) => [`${p.pct}%`, num(p.w)]),
    }),
    [curveRows]
  );

  /** A chart with its data is drawn; one still loading holds its place; one that failed is absent,
   *  and the page's note above the charts says which, with a Retry. */
  const placeholder = (kind: ReportChartKind) => (loading[kind] ? <ChartPlaceholder kind={kind} dayCount={daily.length} /> : null);

  return (
    <section className="report-charts" aria-label={`Charts for ${label}`}>
      {shows('daily') ? <ChartSlot scope="Energy per day" build={dailyScene} table={dailyTable} /> : null}
      {shows('useShare') ? (
        loading.useShare ? (
          placeholder('useShare')
        ) : (
          <ChartSlot scope="Energy by use" build={useScene} table={useTable} summaryLabel="Show the uses" />
        )
      ) : null}
      {shows('breakdown') ? (
        loading.breakdown ? (
          placeholder('breakdown')
        ) : (
          <ChartSlot scope="By circuit" build={breakdownScene} table={breakdownTable} summaryLabel="Show the circuits" />
        )
      ) : null}
      {shows('hours') ? hours ? <ChartSlot scope="A typical day" build={hoursScene} table={hoursTable} /> : placeholder('hours') : null}
      {shows('heat') ? (
        matrix ? (
          <ChartSlot scope="Busy hours" build={heatScene} table={heatTable} summaryLabel="Show each day" />
        ) : (
          placeholder('heat')
        )
      ) : null}
      {shows('curve') ? (
        curve ? (
          <ChartSlot scope="Time at each demand level" build={curveScene} table={curveTable} summaryLabel="Show the levels" />
        ) : (
          placeholder('curve')
        )
      ) : null}
    </section>
  );
}
