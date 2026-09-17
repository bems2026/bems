import { useMemo } from 'react';
import { SITE } from '@shared/siteConfig.mjs';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { coverageOf, formatPeriod, type PeriodBuildingReport, type PeriodDeviceReport, type ReportPeriod } from '@/lib/supabaseReports';
import { buildBreakdown, scopeLabel, scopeMeterIds, scopeRows, type ReportScope } from '@/lib/circuitBreakdown';
import { energyFlagOf, usableEnergy } from '@/lib/boundedEnergy';
import { energyDisagreement } from '@/lib/energyDisagreement';
import { circuitDayPoints, circuitRefs, loadLabelOfCircuit, loadShareSegments, trendChartInput } from '@/lib/circuitCharts';
import type { CircuitTrend, DeviceDaily } from '@/lib/circuitSeries';
import { REPORT_CHART_WIDTH, reportChartHeight } from '@/lib/reportChartSizes';
import { ReportTable, type ReportColumn } from './ReportTable';
import { CoverageTag, ReportFigure } from './ReportFigure';
import { ChartFigure, type ChartTable } from './ChartFigure';
import { ChartPlaceholder } from './ReportSkeleton';
import { ReportSectionNote } from './ReportSectionNote';
import { SCREEN_PALETTE } from './charts/palette';
import { circuitBreakdownChart, type CircuitSegment } from './charts/circuitBreakdownChart';
import { circuitDailyEnergyChart } from './charts/circuitDailyEnergyChart';
import { circuitPowerTrendChart } from './charts/circuitPowerTrendChart';
import type { Scene } from './charts/types';
import type { Section } from './useReportData';

/**
 * Where the energy went, and what it was for — the Circuits tab, rewritten by RM-096.
 *
 * The operator asked to read a week or a month by what the energy was FOR — Lighting, Aircon, Others —
 * and to see each branch circuit's own graphs, as Analytics shows them for "now". So the tab opens on a
 * choice of those categories, then the chosen part of the building in a few figures, then its graphs,
 * then the tables:
 *
 *   chips              All circuits · Lighting · Aircon · Others — the same scope as the control bar's select
 *   key figures        energy, its share of the whole building, how many circuits, the highest circuit demand
 *   agreement          the circuits' sum against the building's own figure (whole building only)
 *   share bar          energy by use, or by circuit when narrowed
 *   energy per day     stacked by circuit (phase42's bounded daily energy)
 *   power              each circuit's hourly power through the period
 *   tables             the circuits, then the devices on them
 *
 * A SHARE IS ALWAYS OF THE WHOLE BUILDING (RM-082c), and the devices sit INSIDE their circuits, so the
 * two tables are never added together — the one sentence of explanation this tab keeps.
 */

interface Props {
  period: ReportPeriod;
  start: string;
  /** Every row of the period; the tab narrows them itself. */
  rows: readonly PeriodDeviceReport[];
  scope: ReportScope;
  nameOf: (id: string) => string;
  building: PeriodBuildingReport | null;
  deviceDaily: Section<DeviceDaily>;
  trend: Section<CircuitTrend>;
}

const kwh = (v: number | null | undefined, digits = 2) => (v === null || v === undefined || !Number.isFinite(v) ? null : v.toFixed(digits));
const w0 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : String(Math.round(v)));

function CircuitChartBody({ build, table, summaryLabel }: { build: () => Scene; table: () => ChartTable; summaryLabel: string }) {
  const scene = useMemo(() => build(), [build]);
  const rows = useMemo(() => table(), [table]);
  return <ChartFigure scene={scene} table={rows} summaryLabel={summaryLabel} />;
}

/** Built inside its own boundary, so one circuit chart that cannot be drawn costs only itself (RM-081). */
function CircuitChart({ scope, build, table, summaryLabel }: { scope: string; build: () => Scene; table: () => ChartTable; summaryLabel: string }) {
  return (
    <ErrorBoundary scope={scope} variant="inline" resetKey={build}>
      <CircuitChartBody build={build} table={table} summaryLabel={summaryLabel} />
    </ErrorBoundary>
  );
}

export function CircuitDeepDive({ period, start, rows, scope, nameOf, building, deviceDaily, trend }: Props) {
  const label = formatPeriod(period, start);
  const narrowed = scopeLabel(scope);
  const refs = useMemo(() => circuitRefs(scope), [scope]);
  const scopeMeters = useMemo(() => new Set(scopeMeterIds(scope)), [scope]);
  const allMeters = useMemo(() => scopeMeterIds({ kind: 'all' }), []);
  const byDevice = useMemo(() => new Map(rows.map((r) => [r.device_id, r])), [rows]);

  // --- key figures ---------------------------------------------------------------------------
  const meterRows = refs.map((c) => byDevice.get(c.meterId)).filter((r): r is PeriodDeviceReport => r !== undefined);
  const counted = meterRows.map(usableEnergy).filter((v): v is number => v !== null);
  const scopeKwh = counted.length > 0 ? counted.reduce((a, v) => a + v, 0) : null;
  const uncounted = refs.length - counted.length;
  const buildingMeterRows = allMeters.map((id) => byDevice.get(id));
  const buildingKwh = buildingMeterRows.every((r) => r !== undefined && usableEnergy(r) !== null)
    ? buildingMeterRows.reduce((a, r) => a + (usableEnergy(r as PeriodDeviceReport) as number), 0)
    : null;
  const scopeCoverage = coverageOf(
    meterRows.reduce((a, r) => a + r.online_sample_count, 0),
    meterRows.reduce((a, r) => a + r.expected_sample_count, 0)
  );
  const highest = meterRows.reduce<number | null>((a, r) => (r.peak_power_w === null ? a : a === null ? r.peak_power_w : Math.max(a, r.peak_power_w)), null);

  // The circuits' sum against the building's own figure — RM-054's thresholds, one-sided, silent without both.
  const buildingOwn = typeof building?.energy_kwh === 'number' ? building.energy_kwh : null;
  const disagreement = !narrowed && buildingKwh !== null ? energyDisagreement(buildingKwh, buildingOwn) : null;

  // --- share bar -------------------------------------------------------------------------------
  const shareSegments = useMemo((): CircuitSegment[] => {
    if (!narrowed) return loadShareSegments(rows);
    const { segments } = buildBreakdown(rows, nameOf);
    return refs.map((c) => ({ ...(segments[allMeters.indexOf(c.meterId)] ?? { kwh: null }), label: c.label, colourIndex: c.colourIndex }));
  }, [narrowed, rows, nameOf, refs, allMeters]);
  const shareTitle = narrowed ? `${narrowed}, by circuit — ${label}` : `Energy by use — ${label}`;
  const buildShare = useMemo(
    () => () =>
      circuitBreakdownChart(shareSegments, {
        width: REPORT_CHART_WIDTH,
        height: reportChartHeight('useShare', 7),
        palette: SCREEN_PALETTE,
        idPrefix: 'cir-share',
        title: shareTitle,
        desc: '',
      }),
    [shareSegments, shareTitle]
  );
  const shareTable = useMemo(
    () => (): ChartTable => {
      const total = shareSegments.reduce((a, s) => a + (s.kwh ?? 0), 0);
      return {
        headers: [narrowed ? 'Circuit' : 'Use', 'Energy (kWh)', 'Share'],
        rows: shareSegments.map((s) => [s.label, kwh(s.kwh), s.kwh === null || total <= 0 ? null : `${((s.kwh / total) * 100).toFixed(1)}%`]),
      };
    },
    [shareSegments, narrowed]
  );

  // --- energy per day ------------------------------------------------------------------------------
  const daily = deviceDaily.data;
  const dayPoints = useMemo(() => (daily && daily.available ? circuitDayPoints(daily.rows, refs) : []), [daily, refs]);
  const buildDaily = useMemo(
    () => () =>
      circuitDailyEnergyChart(dayPoints, refs, {
        width: REPORT_CHART_WIDTH,
        height: reportChartHeight('circuitDaily', dayPoints.length),
        palette: SCREEN_PALETTE,
        idPrefix: 'cir-daily',
        title: `Energy per day, by circuit — ${label}`,
        desc: '',
      }),
    [dayPoints, refs, label]
  );
  const dailyTable = useMemo(
    () => (): ChartTable => ({
      headers: ['Day', ...refs.map((c) => `${c.label} (kWh)`)],
      rows: dayPoints.map((p) => [p.day, ...p.values.map((v) => kwh(v))]),
    }),
    [dayPoints, refs]
  );

  // --- power through the period ------------------------------------------------------------------
  const trendInput = useMemo(() => (trend.data ? trendChartInput(trend.data, refs, SITE.utc_offset_minutes) : null), [trend.data, refs]);
  const buildTrend = useMemo(
    () => () =>
      circuitPowerTrendChart(trendInput?.series ?? [], trendInput?.days ?? [], {
        width: REPORT_CHART_WIDTH,
        height: reportChartHeight('circuitTrend', trendInput?.days.length ?? 0),
        palette: SCREEN_PALETTE,
        idPrefix: 'cir-trend',
        title: `Power through the ${period} — ${label}`,
        desc: '',
      }),
    [trendInput, period, label]
  );
  const trendTable = useMemo(
    () => (): ChartTable => {
      const days = trendInput?.days ?? [];
      const series = trendInput?.series ?? [];
      const n = series[0]?.points.length ?? 0;
      return {
        headers: ['Day', ...series.flatMap((s) => [`${s.label} average (W)`, `${s.label} highest (W)`])],
        rows: days.map((d, k) => {
          const to = days[k + 1]?.index ?? n;
          return [
            d.key,
            ...series.flatMap((s) => {
              const values = s.points.slice(d.index, to).filter((v): v is number => v !== null);
              return values.length === 0 ? [null, null] : [w0(values.reduce((a, v) => a + v, 0) / values.length), w0(Math.max(...values))];
            }),
          ];
        }),
      };
    },
    [trendInput]
  );

  // --- tables ------------------------------------------------------------------------------------
  const coverage = (r: PeriodDeviceReport) => coverageOf(r.online_sample_count, r.expected_sample_count);
  const circuitOf = (deviceId: string) => refs.find((c) => c.meterId === deviceId);
  const energyCell = (r: PeriodDeviceReport) => (
    <ReportFigure value={r.energy_kwh} unit="" digits={2} coverage={coverage(r)} period={period} flag={energyFlagOf(r)} />
  );
  const common: ReportColumn<PeriodDeviceReport>[] = [
    { id: 'peak', header: 'Highest', unit: 'W', numeric: true, cell: (r) => <ReportFigure value={r.peak_power_w} unit="" digits={0} coverage={coverage(r)} period={period} /> },
    { id: 'average', header: 'Average', unit: 'W', numeric: true, cell: (r) => <ReportFigure value={r.avg_power_w} unit="" digits={0} coverage={coverage(r)} period={period} /> },
    { id: 'recorded', header: 'Recorded', cell: (r) => <CoverageTag coverage={coverage(r)} period={period} /> },
  ];
  const circuitColumns: ReportColumn<PeriodDeviceReport>[] = [
    { id: 'circuit', header: 'Circuit', cell: (r) => circuitOf(r.device_id)?.label ?? nameOf(r.device_id) },
    {
      id: 'use',
      header: 'Use',
      cell: (r) => {
        const c = circuitOf(r.device_id);
        return c ? loadLabelOfCircuit(c.id) : null;
      },
    },
    { id: 'energy', header: 'Energy', unit: 'kWh', numeric: true, cell: energyCell },
    {
      id: 'share',
      header: 'Share of building',
      numeric: true,
      cell: (r) => {
        const v = usableEnergy(r);
        return v === null || buildingKwh === null || buildingKwh <= 0 ? null : `${((v / buildingKwh) * 100).toFixed(1)}%`;
      },
    },
    ...common,
  ];
  const deviceColumns: ReportColumn<PeriodDeviceReport>[] = [
    { id: 'device', header: 'Device', cell: (r) => nameOf(r.device_id) },
    { id: 'energy', header: 'Energy', unit: 'kWh', numeric: true, cell: energyCell },
    ...common,
  ];
  const deviceRows = scopeRows(rows, scope).filter((r) => !scopeMeters.has(r.device_id));

  return (
    <>
      <section className="devices-table-card reports-summary report-circuits" aria-label={`Circuit summary for ${label}`}>
        {/* RM-102: the use pills that stood here are inside the control bar's Circuit button now — one
            control for one state, and the bar is where a reader narrows the report. */}
        <h2 className="card-title">{narrowed ?? 'All circuits'}</h2>
        <dl className="report-kpis">
          <div className="report-kpi--hero">
            <dt>Energy</dt>
            <dd className="report-kpi__hero-value">
              <ReportFigure value={scopeKwh} unit="kWh" digits={2} coverage={scopeCoverage} period={period} />
              {uncounted > 0 ? (
                <span className="reports-figure__caveat report-kpi__sub">
                  {uncounted} of {refs.length} circuits not counted
                </span>
              ) : null}
            </dd>
          </div>
          {narrowed ? (
            <div>
              <dt>Share of the building</dt>
              <dd>
                {scopeKwh === null || buildingKwh === null || buildingKwh <= 0 || uncounted > 0 ? (
                  <span className="reports-figure reports-figure--missing">—</span>
                ) : (
                  <span className="reports-figure">{((scopeKwh / buildingKwh) * 100).toFixed(1)}%</span>
                )}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Circuits</dt>
            <dd>
              <span className="reports-figure">{refs.length}</span>
            </dd>
          </div>
          <div>
            <dt>Highest circuit demand</dt>
            <dd>
              <ReportFigure value={highest === null ? null : highest / 1000} unit="kW" digits={2} coverage={scopeCoverage} period={period} />
            </dd>
          </div>
        </dl>

        {!narrowed && buildingKwh !== null && buildingOwn !== null ? (
          disagreement ? (
            <p className="reports-note" role="note">
              <span className="badge badge--warn">Check the meters</span> The circuits add up to {buildingKwh.toFixed(2)} kWh, more than
              the building’s own {buildingOwn.toFixed(2)} kWh.
            </p>
          ) : (
            <p className="reports-note">
              <span className="badge badge--good">Adds up</span> The circuits add up to {buildingKwh.toFixed(2)} of the building’s{' '}
              {buildingOwn.toFixed(2)} kWh.
            </p>
          )
        ) : null}
        <p className="reports-note">Devices sit inside their circuit — adding the two tables together would count the same energy twice.</p>
      </section>

      <section className="report-charts" aria-label={`Circuit charts for ${label}`}>
        <CircuitChart scope={narrowed ? 'By circuit' : 'Energy by use'} build={buildShare} table={shareTable} summaryLabel="Show the numbers" />

        <ReportSectionNote section={deviceDaily} what="the daily figures per circuit" />
        {deviceDaily.status === 'loading' ? (
          <ChartPlaceholder kind="circuitDaily" dayCount={7} />
        ) : daily && !daily.available ? (
          <p className="reports-note" role="note">
            Energy per day by circuit appears once the database update (phase42) is applied.
          </p>
        ) : daily ? (
          <CircuitChart scope="Energy per day, by circuit" build={buildDaily} table={dailyTable} summaryLabel="Show each day" />
        ) : null}

        <ReportSectionNote section={trend} what="the power per circuit" />
        {trend.status === 'loading' ? (
          <ChartPlaceholder kind="circuitTrend" dayCount={7} />
        ) : trendInput ? (
          <CircuitChart scope="Power through the period" build={buildTrend} table={trendTable} summaryLabel="Show each day" />
        ) : null}
      </section>

      {meterRows.length > 0 ? (
        <div className="report-table-card">
          <ReportTable columns={circuitColumns} rows={meterRows} rowKey={(r) => r.device_id} label={`Branch circuits for ${label}`} caption="Branch circuits" />
        </div>
      ) : null}
      {deviceRows.length > 0 ? (
        <details className="report-table-card report-devices">
          <summary className="report-recorded__summary">
            Devices on {narrowed ?? 'these circuits'} ({deviceRows.length})
          </summary>
          <ReportTable
            columns={deviceColumns}
            rows={deviceRows}
            rowKey={(r) => r.device_id}
            label={`Devices on these circuits for ${label}`}
            caption="Devices on these circuits"
          />
        </details>
      ) : null}
    </>
  );
}
