import { useMemo, useState } from 'react';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { InfoHint } from '@/components/ui/InfoHint';
import { PillGroup } from '@/components/ui/PillGroup';
import { BASELINE_LEDE, BASELINE_OWN_WINDOW, BASELINE_TITLE } from '@shared/reportProse.mjs';
import {
  SITE_BASELINE,
  SITE_HOLIDAYS,
  baselineAssumptionItems,
  chartDesc,
  compareWithBaseline,
  dayNoun,
  dayTypeCounts,
  describeAgainstBaseline,
  expectedFor,
  loadSeries,
  monthShort,
  periodDates,
  profilePoints,
  recordedDayPoints,
  shortDate,
  weekPoints,
  windowText,
  type BaselineComparison,
  type BaselineProfile,
  type Holiday,
  type ProjectedBaseline,
} from '@/lib/baselineCompare';
import { loadShareSegments } from '@/lib/circuitCharts';
import { carbonOf, costOf } from '@/lib/energyCost';
import { reportChartHeight } from '@/lib/reportChartSizes';
import { coverageOf, formatPeriod, type PeriodBuildingReport, type PeriodDeviceReport, type ReportPeriod } from '@/lib/supabaseReports';
import { useChartWidth } from './chartWidth';
import { ChartFigure, type ChartTable } from './ChartFigure';
import { circuitDailyEnergyChart, type CircuitDayPoint } from './charts/circuitDailyEnergyChart';
import { SCREEN_PALETTE } from './charts/palette';
import { CostCarbonLine } from './CostCarbonLine';
import { ReportCaveats } from './ReportCaveats';
import { ReportTable, type ReportColumn } from './ReportTable';
import type { PricingData, Section } from './useReportData';

/**
 * The projected baseline — RM-153. What this office uses as a matter of routine, and the period set
 * against it.
 *
 * The operator asked for a baseline with complete daily, weekly and monthly figures, built from the
 * August and September recordings: weekdays working 08:00–17:00, weekends not, no holidays, no work from
 * home, and nothing managing the load. It is the reference energy avoided is measured from
 * (avoided = baseline − actual), so it is shown two ways, switchable:
 *
 *   Projected baseline   the model: a working day, a Saturday and a Sunday, each hour the average of its
 *                        days leaving out the highest and lowest; a week of them; a month of weeks.
 *   Recorded             the days it was built from, as they were, with what the model did with each
 *                        — the raw figures behind every projected one, so the model can be checked.
 *
 * The page's Daily / Weekly / Monthly choice picks the resolution. Below both, the selected period is
 * set against the baseline over its own calendar (`src/lib/baselineCompare.ts`), and not at all when
 * less than 95% of it was recorded.
 *
 * NO FETCH. The baseline is the site's committed `baseline.mjs`; the comparison uses the period rows the
 * page already holds. Nothing here can time out.
 */

interface Props {
  period: ReportPeriod;
  start: string;
  building: PeriodBuildingReport | null;
  rows: readonly PeriodDeviceReport[] | null;
  pricing: Section<PricingData>;
  /** The site's by default; a test hands its own. */
  baseline?: ProjectedBaseline | null;
  holidays?: readonly Holiday[];
}

type View = 'projected' | 'recorded';

const kwh = (v: number | null | undefined, digits: number) => (v === null || v === undefined || !Number.isFinite(v) ? null : `${v.toFixed(digits)} kWh`);
const kw = (w: number | null | undefined) => (w === null || w === undefined || !Number.isFinite(w) ? null : `${(w / 1000).toFixed(2)} kW`);
const watts = (w: number | null | undefined) => (w === null || w === undefined || !Number.isFinite(w) ? null : `${Math.round(w)} W`);

function Tile({ term, value, sub, hero = false }: { term: string; value: string | null; sub?: string; hero?: boolean }) {
  return (
    <div className={hero ? 'report-kpi--hero' : undefined}>
      <dt>{term}</dt>
      <dd className={hero ? 'report-kpi__hero-value' : undefined}>
        {value === null ? <span className="reports-figure reports-figure--missing">—</span> : <span className="reports-figure">{value}</span>}
        {sub ? <span className="reports-figure__caveat report-kpi__sub">{sub}</span> : null}
      </dd>
    </div>
  );
}

/** One stacked chart, in its own boundary so a chart that cannot be drawn costs only itself (RM-081). */
function BaselineChart(props: {
  idPrefix: string;
  title: string;
  /** What the chart shows, in words — its columns are modelled hours or days, not recorded days. */
  desc: string;
  points: CircuitDayPoint[];
  b: ProjectedBaseline;
  shadeWorkingHours?: boolean;
  firstHeader: string;
}) {
  return (
    <ErrorBoundary scope="This chart" variant="inline" resetKey={props.points}>
      <BaselineChartBody {...props} />
    </ErrorBoundary>
  );
}

function BaselineChartBody({ idPrefix, title, desc, points, b, shadeWorkingHours = false, firstHeader }: Parameters<typeof BaselineChart>[0]) {
  const width = useChartWidth();
  const series = useMemo(() => loadSeries(b), [b]);
  const scene = useMemo(() => {
    const start = Number(b.working_hours.start.slice(0, 2));
    const end = Number(b.working_hours.end.slice(0, 2));
    const band = shadeWorkingHours ? { from: start, to: end - 1, label: `Working hours ${b.working_hours.start}–${b.working_hours.end}` } : undefined;
    return circuitDailyEnergyChart(
      points,
      series,
      { width, height: reportChartHeight('circuitDaily', points.length), palette: SCREEN_PALETTE, idPrefix, title, desc: '' },
      { band, desc }
    );
  }, [points, series, width, idPrefix, title, desc, shadeWorkingHours, b.working_hours.start, b.working_hours.end]);
  const table = useMemo(
    (): ChartTable => ({
      headers: [firstHeader, ...series.map((s) => `${s.label} (kWh)`), 'Total (kWh)'],
      rows: points.map((p) => [
        p.day,
        ...p.values.map((v) => (v === null ? null : v.toFixed(3))),
        p.observed ? p.values.reduce<number>((a, v) => a + (v ?? 0), 0).toFixed(3) : null,
      ]),
    }),
    [points, series, firstHeader]
  );
  return <ChartFigure scene={scene} table={table} />;
}

/** The four figures of one day, projected or recorded — and named as which, since an average of what happened
 *  is not an expectation. */
function DayTiles({ p, label, recorded = false }: { p: BaselineProfile; label: string; recorded?: boolean }) {
  return (
    <dl className="report-kpis">
      <Tile hero term={recorded ? 'Recorded energy' : 'Expected energy'} value={kwh(p.kwh.total, 2)} sub={`${label}, ${Math.round(p.working_hours_share * 100)}% of it in working hours`} />
      <Tile term={recorded ? 'Working-hours demand' : 'Expected demand'} value={kw(p.working_hours_avg_w)} sub="The average draw in working hours" />
      <Tile term="Base standby load" value={watts(p.standby_w)} sub="What stays on overnight, 00:00–05:00" />
      <Tile term="Highest hour" value={kw(p.highest_hourly_w)} sub="The busiest hour's average draw" />
    </dl>
  );
}

function AgainstBaseline({ c, period, label }: { c: BaselineComparison; period: ReportPeriod; label: string }) {
  if (!c.comparable) {
    return (
      <section className="report-baseline__against" aria-label={`Against the baseline, ${label}`}>
        <h2 className="card-title">Against the baseline — {label}</h2>
        <p className="reports-note" role="note">
          <span className="badge badge--warn">Not compared</span> {c.reason}
        </p>
      </section>
    );
  }
  const columns: ReportColumn<(typeof c.byLoad)[number]>[] = [
    { id: 'use', header: 'Use', cell: (r) => r.label },
    { id: 'expected', header: 'Expected', unit: 'kWh', numeric: true, cell: (r) => r.expectedKwh.toFixed(1) },
    { id: 'recorded', header: 'Recorded', unit: 'kWh', numeric: true, cell: (r) => (r.recordedKwh === null ? '—' : r.recordedKwh.toFixed(1)) },
    {
      id: 'difference',
      header: 'Difference',
      unit: 'kWh',
      numeric: true,
      cell: (r) => (r.recordedKwh === null ? '—' : `${Math.abs(r.recordedKwh - r.expectedKwh).toFixed(1)} ${r.recordedKwh <= r.expectedKwh ? 'less' : 'more'}`),
    },
  ];
  return (
    <section className="report-baseline__against" aria-label={`Against the baseline, ${label}`}>
      <h2 className="card-title">Against the baseline — {label}</h2>
      <dl className="report-kpis">
        <Tile hero term="Energy avoided" value={c.avoidedKwh > 0 ? kwh(c.avoidedKwh, 1) : 'None'} sub={describeAgainstBaseline(c, period)} />
        <Tile term="Expected" value={kwh(c.expectedKwh, 1)} sub={c.holidays.length > 0 ? `${c.holidays.length} holiday${c.holidays.length === 1 ? '' : 's'} counted as closed` : 'Over this period’s own days'} />
        <Tile term="Recorded" value={kwh(c.recordedKwh, 1)} sub="At least 95% of the period recorded" />
      </dl>
      {c.holidays.length > 0 ? (
        <p className="reports-note">Counted as closed days: {c.holidays.map((h) => `${shortDate(h.date)}, ${h.name}`).join('; ')}.</p>
      ) : null}
      {c.ownWindowDays > 0 ? (
        <p className="reports-note" role="note">
          {BASELINE_OWN_WINDOW}
        </p>
      ) : null}
      <ReportTable label={`By use, against the baseline, ${label}`} columns={columns} rows={c.byLoad} rowKey={(r) => r.load} />
    </section>
  );
}

export function BaselineReport({ period, start, building, rows, pricing, baseline = SITE_BASELINE, holidays = SITE_HOLIDAYS }: Props) {
  const [view, setView] = useState<View>('projected');
  const b = baseline;
  const typeIds = b ? Object.keys(b.day_types) : [];
  const [dayType, setDayType] = useState<string>(typeIds[0] ?? '');
  const [group, setGroup] = useState<string>(b?.recorded.profiles[0]?.key ?? '');
  const label = formatPeriod(period, start);

  const comparison = useMemo((): BaselineComparison | null => {
    if (!building) return null;
    const byLoad = Object.fromEntries(loadShareSegments(rows ?? []).map((s) => [s.id, s.kwh]));
    return compareWithBaseline({
      baseline: b,
      period,
      start,
      holidays,
      recordedKwh: building.energy_kwh,
      recordedByLoad: byLoad,
      coverage: coverageOf(building.online_sample_count, building.expected_sample_count),
    });
  }, [b, building, rows, period, start, holidays]);

  const monthExpected = useMemo(() => (b && period === 'month' ? expectedFor(b, periodDates('month', start), []) : null), [b, period, start]);
  const monthPriced = useMemo(() => {
    if (!b || period !== 'month') return null;
    const days = periodDates('month', start).map((day) => ({ day, kwh: expectedFor(b, [day], []).kwh.total }));
    return { cost: costOf(days, pricing.data?.tariffs ?? []), carbon: carbonOf(days, pricing.data?.factors ?? []) };
  }, [b, period, start, pricing.data]);

  if (!b) {
    return (
      <section className="reports-summary devices-table-card" aria-label="Baseline">
        <h2 className="card-title">No baseline yet</h2>
        <p className="reports-note">
          A baseline is what this building uses as a matter of routine, so it is built from at least four weeks recorded with nothing
          managing the load. Once those are recorded, it is built on the edge with <code>npm run baseline:build</code>.
        </p>
      </section>
    );
  }

  const recordedLabel = `Recorded ${monthShort(b.recorded.from)}–${monthShort(b.recorded.to)}`;
  const dayTypeId = b.day_types[dayType] ? dayType : typeIds[0];
  const projectedDay = b.day_types[dayTypeId];
  const recordedGroup = b.recorded.profiles.find((p) => p.key === group) ?? b.recorded.profiles[0];
  const usedDays = b.recorded.days.filter((d) => d.used_as !== null).length;
  const monthName = period === 'month' ? formatPeriod('month', start) : '';

  const recordedColumns: ReportColumn<(typeof b.recorded.days)[number]>[] = [
    { id: 'day', header: 'Day', cell: (d) => d.date },
    { id: 'weekday', header: 'Weekday', cell: (d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.weekday] },
    ...b.loads.map((l) => ({ id: l, header: loadSeries(b).find((s) => s.id === l)?.label ?? l, unit: 'kWh', numeric: true, cell: (d: (typeof b.recorded.days)[number]) => (d.hours_recorded > 0 ? (d.kwh[l] ?? 0).toFixed(2) : '—') })),
    { id: 'total', header: 'Total', unit: 'kWh', numeric: true, cell: (d) => (d.hours_recorded > 0 ? d.kwh.total.toFixed(2) : '—') },
    { id: 'hours', header: 'Hours recorded', numeric: true, cell: (d) => d.hours_recorded },
    { id: 'use', header: 'In the baseline', cell: (d) => (d.used_as ? `Used: ${b.day_types[d.used_as]?.label ?? d.used_as}` : `Left out: ${d.reason ?? '—'}`) },
  ];

  return (
    <>
      <section className="reports-summary devices-table-card report-baseline" aria-label="Baseline">
        <header className="report-heading">
          <h2 className="report-heading__title">
            Baseline · business as usual{' '}
            <InfoHint>
              Typical weekdays as working days, 08:00–17:00, with no holidays and no working from home; weekends as no working hours; and
              no energy-saving measures applied. Built from the August and September recordings, and kept with the recorded days as a
              backup.
            </InfoHint>
          </h2>
          <p className="report-heading__meta">{BASELINE_LEDE}</p>
          <p className="report-heading__meta">
            Built from {windowText(b)}: {dayTypeCounts(b)}.
          </p>
        </header>

        <PillGroup<View>
          label="Baseline view"
          options={[
            { value: 'projected', label: 'Projected baseline' },
            { value: 'recorded', label: recordedLabel },
          ]}
          value={view}
          onChange={setView}
        />

        {/* ---- Daily ---- */}
        {period === 'day' && view === 'projected' ? (
          <>
            <PillGroup label="Which day" options={typeIds.map((t) => ({ value: t, label: b.day_types[t].label }))} value={dayTypeId} onChange={setDayType} />
            <DayTiles p={projectedDay} label={`A ${dayNoun(projectedDay.label)}`} />
            <BaselineChart
              b={b}
              idPrefix="bl-day"
              desc={chartDesc.projectedDay(b, projectedDay)}
              title={`A ${dayNoun(projectedDay.label)}, hour by hour — projected baseline`}
              points={profilePoints(projectedDay, b.loads)}
              shadeWorkingHours
              firstHeader="Hour"
            />
          </>
        ) : null}
        {period === 'day' && view === 'recorded' ? (
          <>
            <PillGroup label="Which days" options={b.recorded.profiles.map((p) => ({ value: p.key, label: p.label }))} value={recordedGroup.key} onChange={setGroup} />
            <DayTiles recorded p={recordedGroup} label={`The average of ${recordedGroup.days.length} recorded day${recordedGroup.days.length === 1 ? '' : 's'} (${recordedGroup.label})`} />
            <BaselineChart
              b={b}
              idPrefix="bl-rec-day"
              desc={chartDesc.recordedDay(b, recordedGroup)}
              title={`${recordedGroup.label}, hour by hour — as recorded`}
              points={profilePoints(recordedGroup, b.loads)}
              shadeWorkingHours
              firstHeader="Hour"
            />
          </>
        ) : null}

        {/* ---- Weekly ---- */}
        {period === 'week' && view === 'projected' ? (
          <>
            <dl className="report-kpis">
              <Tile hero term="Expected energy" value={kwh(b.week.kwh.total, 1)} sub="A typical week: five working days, a Saturday and a Sunday" />
              {loadSeries(b).map((s) => (
                <Tile key={s.id} term={s.label} value={kwh(b.week.kwh[s.id], 1)} sub={`${Math.round(((b.week.kwh[s.id] ?? 0) / b.week.kwh.total) * 100)}% of the week`} />
              ))}
            </dl>
            <BaselineChart b={b} idPrefix="bl-week" title="A typical week, day by day — projected baseline" desc={chartDesc.week()} points={weekPoints(b)} firstHeader="Day" />
          </>
        ) : null}

        {/* ---- Monthly ---- */}
        {period === 'month' && view === 'projected' ? (
          <>
            <dl className="report-kpis">
              <Tile
                hero
                term="Expected energy"
                value={kwh(b.standard_month.kwh.total, 0)}
                sub={`A standard month of ${b.standard_month.days.toFixed(2)} days${monthExpected ? `; ${monthName} as a full working month: ${monthExpected.kwh.total.toFixed(0)} kWh` : ''}`}
              />
              <Tile term="Expected demand" value={kw(b.day_types[b.week.days[1]]?.working_hours_avg_w)} sub={`A working day's average draw, ${b.working_hours.start}–${b.working_hours.end}`} />
              <Tile term="Base standby load" value={watts(b.day_types[b.week.days[1]]?.standby_w)} sub="What stays on overnight" />
              <Tile
                term="Peak operating draw"
                value={kw(b.peak_operating_draw.w)}
                sub={`The highest minute of a busy working day: ${Math.round(b.peak_operating_draw.quantile * 10)} in 10 of ${b.peak_operating_draw.days} working days stayed below it`}
              />
              {monthPriced ? <CostCarbonLine cost={monthPriced.cost} carbon={monthPriced.carbon} coverage={{ ratio: 1, band: 'complete' }} pricing={pricing} /> : null}
            </dl>
            <ReportTable
              label="The baseline by use"
              caption="By use — a working day, a typical week and a standard month"
              columns={[
                { id: 'use', header: 'Use', cell: (r: { id: string; label: string }) => r.label },
                { id: 'day', header: 'A working day', unit: 'kWh', numeric: true, cell: (r) => (b.day_types[b.week.days[1]].kwh[r.id] ?? 0).toFixed(2) },
                { id: 'week', header: 'A week', unit: 'kWh', numeric: true, cell: (r) => (b.week.kwh[r.id] ?? 0).toFixed(1) },
                { id: 'month', header: 'A month', unit: 'kWh', numeric: true, cell: (r) => (b.standard_month.kwh[r.id] ?? 0).toFixed(0) },
              ]}
              rows={[...loadSeries(b), { id: 'total', label: 'Total' }]}
              rowKey={(r) => r.id}
            />
          </>
        ) : null}

        {/* ---- Recorded, week and month: every day, and what became of it ---- */}
        {period !== 'day' && view === 'recorded' ? (
          <>
            <BaselineChart
              b={b}
              idPrefix="bl-rec"
              desc={chartDesc.recordedDays(b)}
              title={`Every recorded day, ${monthShort(b.recorded.from)}–${monthShort(b.recorded.to)} — as recorded`}
              points={recordedDayPoints(b)}
              firstHeader="Day"
            />
            <p className="reports-note">
              {usedDays} of {b.recorded.days.length} recorded days went into the baseline; each one left out says why.
            </p>
            <details className="report-table-card">
              <summary className="report-recorded__summary">The recorded days</summary>
              <ReportTable label="The recorded days behind the baseline" columns={recordedColumns} rows={b.recorded.days} rowKey={(d) => d.date} />
            </details>
          </>
        ) : null}
      </section>

      {comparison ? (
        <ErrorBoundary scope="The comparison with the baseline" variant="inline" resetKey={comparison}>
          <AgainstBaseline c={comparison} period={period} label={label} />
        </ErrorBoundary>
      ) : null}

      <ReportCaveats title={BASELINE_TITLE} items={baselineAssumptionItems(b)} />
    </>
  );
}
