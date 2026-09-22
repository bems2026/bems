import { useCallback, useId, useMemo } from 'react';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { apportionedEstimates, estimateDayPoints, estimateHourPoints, shareWords, type ApportionedEstimate } from '@/lib/apportionment';
import { energyFlagText } from '@/lib/boundedEnergy';
import { LOAD_LABELS } from '@shared/circuits.mjs';
import { formatPeriod, type PeriodDeviceReport, type ReportPeriod } from '@/lib/supabaseReports';
import type { DeviceDaily } from '@/lib/circuitSeries';
import type { HourEnergyRow } from '@/lib/reportSeries';
import { reportChartHeight } from '@/lib/reportChartSizes';
import { useChartWidth } from './chartWidth';
import { ChartFigure, type ChartTable } from './ChartFigure';
import { ChartPlaceholder } from './ReportSkeleton';
import { ReportFigure } from './ReportFigure';
import { SCREEN_PALETTE } from './charts/palette';
import { dailyEnergyChart } from './charts/dailyEnergyChart';
import { hourlyEnergyChart } from './charts/hourlyEnergyChart';
import type { Section } from './useReportData';

/**
 * Loads nobody metered, shown as the estimates they are — RM-130 / FI-035.
 *
 * The director's office aircon is on C.O Yellow with the CARE office's outlets, at about two thirds of
 * the branch by the operator's word. Its figure is the branch's measured energy split by that share,
 * and this section is the one place on the page that number appears — with "≈" before it, the share
 * in words, its basis, what it leaves for the outlets, and the branch's own caveats. The measured
 * charts are untouched: "Energy by use" still counts all of C.O Yellow as Others, and this section
 * says how much the estimate would move, rather than moving it.
 *
 * Renders nothing when the site declares no apportionment, and nothing for a branch the page is not
 * showing — an estimate for a circuit the reader has narrowed away from would be an answer to a
 * question they did not ask.
 */

interface Props {
  rows: readonly PeriodDeviceReport[];
  period: ReportPeriod;
  start: string;
  /** The branch meters on the page; an estimate is shown only when its branch is among them. */
  meterIds: readonly string[];
  /** The branch's days (a week or month) and hours (a day), from which the estimate's bars are scaled. */
  deviceDaily?: Section<DeviceDaily>;
  hourEnergy?: Section<HourEnergyRow[]>;
}

const num = (v: number | null) => (v === null || !Number.isFinite(v) ? null : `≈ ${v.toFixed(2)}`);

/**
 * The estimate's own bar chart — the branch's per-day (or, for a day, per-hour) energy scaled by
 * the share, drawn through the same builders the circuits use, with every bar hatched and every
 * value carrying ≈. It is shown on the same footing as the circuit charts because that is where a
 * reader would look for it, and drawn differently because it is a different kind of number.
 */
function EstimateChart({ e, period, start, deviceDaily, hourEnergy }: { e: ApportionedEstimate; period: ReportPeriod; start: string; deviceDaily?: Section<DeviceDaily>; hourEnergy?: Section<HourEnergyRow[]> }) {
  const label = formatPeriod(period, start);
  const basis = `${shareWords(e.share)} of ${e.branchLabel} — ${e.basis}`;
  // RM-142: drawn at the width the page has.
  const chartWidth = useChartWidth();
  const spec = useMemo(
    () => (idPrefix: string, height: number, title: string) => ({ width: chartWidth, height, palette: SCREEN_PALETTE, idPrefix, title, desc: '' }),
    [chartWidth]
  );
  const dayRows = period !== 'day' && deviceDaily?.data?.available ? deviceDaily.data.rows : null;
  const hourRows = period === 'day' ? (hourEnergy?.data ?? null) : null;
  const dayPoints = useMemo(() => (dayRows ? estimateDayPoints(dayRows, e) : []), [dayRows, e]);
  const hourPoints = useMemo(() => (hourRows ? estimateHourPoints(hourRows, e) : []), [hourRows, e]);

  const buildDay = useCallback(
    () => dailyEnergyChart(dayPoints, spec(`est-${e.id}-d`, reportChartHeight('daily', dayPoints.length), `${e.label}, per day — ${label}`), { estimate: basis }),
    [dayPoints, spec, e.id, e.label, label, basis]
  );
  const tableDay = useCallback(
    (): ChartTable => ({ headers: ['Day', 'Estimated energy (kWh)'], rows: dayPoints.map((p) => [p.day, p.observed ? num(p.kwh) : null]) }),
    [dayPoints]
  );
  const buildHour = useCallback(
    () => hourlyEnergyChart(hourPoints, spec(`est-${e.id}-h`, reportChartHeight('hourly', 1), `${e.label}, per hour — ${label}`), { estimate: basis }),
    [hourPoints, spec, e.id, e.label, label, basis]
  );
  const tableHour = useCallback(
    (): ChartTable => ({
      headers: ['Hour', 'Estimated energy (kWh)', 'Average (W)'],
      rows: hourPoints.map((p) => [`${String(p.hour).padStart(2, '0')}:00`, p.observed ? num(p.kwh) : null, p.avgW === null ? null : `≈ ${Math.round(p.avgW)}`]),
    }),
    [hourPoints]
  );

  const loading = period === 'day' ? hourEnergy?.status === 'loading' : deviceDaily?.status === 'loading';
  if (loading) return <ChartPlaceholder kind={period === 'day' ? 'hourly' : 'daily'} dayCount={period === 'week' ? 7 : 31} />;
  if (period === 'day' ? !hourRows : !dayRows) return null;
  const build = period === 'day' ? buildHour : buildDay;
  const table = period === 'day' ? tableHour : tableDay;
  return (
    <ErrorBoundary scope={`${e.label}, charted`} variant="inline" resetKey={build}>
      <EstimateChartBody build={build} table={table} summaryLabel={period === 'day' ? 'Show each hour' : 'Show each day'} />
    </ErrorBoundary>
  );
}

function EstimateChartBody({ build, table, summaryLabel }: { build: () => ReturnType<typeof dailyEnergyChart>; table: () => ChartTable; summaryLabel: string }) {
  const scene = useMemo(() => build(), [build]);
  const rows = useMemo(() => table(), [table]);
  return <ChartFigure scene={scene} table={rows} summaryLabel={summaryLabel} />;
}

function Estimate({ e, period, start, deviceDaily, hourEnergy }: { e: ApportionedEstimate; period: ReportPeriod; start: string; deviceDaily?: Section<DeviceDaily>; hourEnergy?: Section<HourEnergyRow[]> }) {
  const refused = e.flag?.kind === 'impossible';
  return (
    <div className="report-apportioned__item">
      {/* RM-142: a tile per figure — its name, the number, then where the number comes from. They ran together
          on one line, the basis text wedged between one figure and the next. */}
      <dl className="report-apportioned__figures">
        <div className="report-apportioned__figure">
          <dt>{e.label}</dt>
          <dd className="report-apportioned__value">
            {refused ? (
              <span className="reports-figure__caveat">{energyFlagText(e.flag!)}</span>
            ) : (
              <>
                ≈ <ReportFigure value={e.estimatedKwh} unit="kWh" digits={2} coverage={e.coverage} period={period} />
              </>
            )}
          </dd>
          <dd className="report-apportioned__basis">
            {shareWords(e.share)} of {e.branchLabel} — {e.basis}
          </dd>
        </div>
        <div className="report-apportioned__figure">
          <dt>{e.branchLabel}, the rest</dt>
          <dd className="report-apportioned__value">
            {refused ? (
              <span className="reports-figure__caveat">Not possible, as above</span>
            ) : (
              <>
                ≈ <ReportFigure value={e.remainderKwh} unit="kWh" digits={2} coverage={e.coverage} period={period} />
              </>
            )}
          </dd>
          <dd className="report-apportioned__basis">{shareWords(1 - e.share)}, the outlets</dd>
        </div>
        <div className="report-apportioned__figure">
          <dt>{e.branchLabel}, measured</dt>
          <dd className="report-apportioned__value">
            {refused ? (
              <span className="reports-figure__caveat">Not possible</span>
            ) : (
              <ReportFigure value={e.branchKwh} unit="kWh" digits={2} coverage={e.coverage} period={period} />
            )}
          </dd>
          <dd className="report-apportioned__basis">the branch meter’s own figure</dd>
        </div>
      </dl>
      <p className="report-apportioned__note">
        “Energy by use” counts all of {e.branchLabel} as {LOAD_LABELS[e.branchLoad]}; this estimate would move{' '}
        {refused || e.estimatedKwh === null ? 'its share' : `≈ ${e.estimatedKwh.toFixed(2)} kWh`} of it to {LOAD_LABELS[e.load]}. It is not
        moved, because a chart of measurements should not carry an estimate.
      </p>
      {refused ? null : <EstimateChart e={e} period={period} start={start} deviceDaily={deviceDaily} hourEnergy={hourEnergy} />}
    </div>
  );
}

export function ApportionedLoads({ rows, period, start, meterIds, deviceDaily, hourEnergy }: Props) {
  const headingId = useId();
  const shown = new Set(meterIds);
  const estimates = apportionedEstimates(rows).filter((e) => shown.has(e.meterId));
  if (estimates.length === 0) return null;
  return (
    <section className="report-table-card report-apportioned" aria-labelledby={headingId}>
      <header className="report-apportioned__head">
        <h3 id={headingId} className="report-apportioned__title">
          Estimated, not metered
        </h3>
        <p className="report-apportioned__lede">
          These loads share a branch meter with something else. Each figure below is the branch’s measured energy split by a share
          the operator declared — an estimate, not a measurement.
        </p>
      </header>
      {estimates.map((e) => (
        <Estimate key={e.id} e={e} period={period} start={start} deviceDaily={deviceDaily} hourEnergy={hourEnergy} />
      ))}
    </section>
  );
}
