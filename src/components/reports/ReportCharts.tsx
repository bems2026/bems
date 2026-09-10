import { useMemo } from 'react';
import { ChartFigure } from './ChartFigure';
import { SCREEN_PALETTE } from './charts/palette';
import { dailyEnergyChart } from './charts/dailyEnergyChart';
import { loadProfileChart } from './charts/loadProfileChart';
import { demandHeatmapChart } from './charts/demandHeatmapChart';
import { durationCurveChart } from './charts/durationCurveChart';
import { circuitBreakdownChart, type CircuitSegment } from './charts/circuitBreakdownChart';
import {
  toDailyPoints,
  toDurationPoints,
  toHeatCells,
  toHourPoints,
  type CurveRow,
  type DailyRow,
  type HourRow,
  type MatrixRow,
} from '@/lib/reportSeries';
import { formatPeriod, type ReportPeriod } from '@/lib/supabaseReports';

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
 */

export interface ChartsData {
  daily: DailyRow[];
  hours: HourRow[];
  matrix: MatrixRow[];
  curve: CurveRow[];
  segments: CircuitSegment[];
  untracked?: { label: string; kwh: number | null };
  ceilingW: number | null;
}

interface Props extends ChartsData {
  period: ReportPeriod;
  start: string;
  /** Plot width. The kiosk is 1024 wide; the PDF asks for 515pt. */
  width?: number;
}

const num = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined || !Number.isFinite(v) ? null : v.toFixed(digits);

/** `08:00` from a minute-of-day, or an em dash. Minutes, because that is what the SQL returns —
 *  a day marked partial without saying WHICH hours it saw is a caveat nobody can act on. */
const hhmm = (m: number | null) =>
  m === null || m === undefined ? null : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function ReportCharts({ period, start, daily, hours, matrix, curve, segments, untracked, ceilingW, width = 640 }: Props) {
  const label = formatPeriod(period, start);

  const scenes = useMemo(() => {
    const spec = (idPrefix: string, height: number, title: string) => ({
      width,
      height,
      palette: SCREEN_PALETTE,
      idPrefix,
      title,
      desc: '',
    });
    return {
      daily: dailyEnergyChart(toDailyPoints(daily), spec('rep-de', 230, `Energy per day — ${label}`)),
      hours: loadProfileChart(toHourPoints(hours), spec('rep-lp', 220, `Demand by hour — ${label}`)),
      breakdown: circuitBreakdownChart(segments, spec('rep-cb', 100, `Where the energy went — ${label}`), { untracked }),
      heat: demandHeatmapChart(toHeatCells(matrix), spec('rep-hm', daily.length > 10 ? 320 : 200, `Demand by day and hour — ${label}`)),
      curve: durationCurveChart(toDurationPoints(curve), spec('rep-dc', 220, `Load duration — ${label}`), { thresholdW: ceilingW }),
    };
  }, [daily, hours, matrix, curve, segments, untracked, ceilingW, label, width]);

  return (
    <section className="report-charts" aria-label={`Charts for ${label}`}>
      <ChartFigure
        scene={scenes.daily}
        table={{
          headers: ['Day', 'Energy (kWh)', 'Peak (W)', 'Readings', 'Observed'],
          rows: daily.map((r) => [
            r.local_day,
            r.usable_sample_count > 0 ? num(r.energy_kwh, 2) : null,
            num(r.peak_power_w),
            // Rows and readings are different facts and the table shows both, because the
            // difference is the whole reason this column exists.
            `${r.usable_sample_count} of ${r.sample_count}`,
            r.first_seen_minute === null ? null : `${hhmm(r.first_seen_minute)}–${hhmm(r.last_seen_minute)}`,
          ]),
        }}
      />

      <ChartFigure
        scene={scenes.hours}
        table={{
          headers: ['Hour', 'Samples', 'Median (W)', 'p95 (W)', 'Peak (W)'],
          rows: toHourPoints(hours).map((h) => [
            `${String(h.hour).padStart(2, '0')}:00`,
            h.n,
            num(h.p50),
            num(h.p95),
            num(h.max),
          ]),
        }}
      />

      <ChartFigure
        scene={scenes.breakdown}
        table={{
          headers: ['Circuit', 'Energy (kWh)', 'Share'],
          rows: segments.map((s) => {
            const total = segments.reduce((a, x) => a + (x.kwh ?? 0), 0);
            return [s.label, num(s.kwh, 2), s.kwh === null || total <= 0 ? null : `${((s.kwh / total) * 100).toFixed(1)}%`];
          }),
        }}
        summaryLabel="Show the circuits"
      />

      <ChartFigure
        scene={scenes.heat}
        // 744 cells is not a table anyone reads. The per-hour numbers are already in the load
        // profile above; what this one adds is the shape, so its table is the daily roll-up.
        table={{
          headers: ['Day', 'Hours with readings', 'Busiest hour', 'Peak (W)'],
          rows: daily.map((r) => {
            const forDay = matrix.filter((c) => c.local_day.slice(0, 10) === r.local_day.slice(0, 10) && c.usable_sample_count > 0);
            const busiest = [...forDay].sort((a, b) => (b.avg_power_w ?? 0) - (a.avg_power_w ?? 0))[0];
            return [
              r.local_day,
              forDay.length,
              busiest ? `${String(busiest.local_hour).padStart(2, '0')}:00` : null,
              busiest ? num(busiest.max_power_w) : null,
            ];
          }),
        }}
        summaryLabel="Show the daily roll-up"
      />

      <ChartFigure
        scene={scenes.curve}
        // Every tenth point: 101 rows of a smooth curve is noise, and the shape is the finding.
        table={{
          headers: ['Share of period', 'At or above (W)'],
          rows: toDurationPoints(curve)
            .filter((_, i) => i % 10 === 0)
            .map((p) => [`${p.pct}%`, num(p.w)]),
        }}
        summaryLabel="Show the curve"
      />
    </section>
  );
}
