import { useEffect, useMemo, useState } from 'react';
import { ReportCaveats } from './ReportCaveats';
import { AgainstBaseline } from './AgainstBaseline';
import type { BaselineComparison } from '@/lib/baselineCompare';
import { conservedBuilding } from '@/lib/periodEnergy';
import { NOT_SAID_TITLE, PLAIN_COMPARISON_LIMITS, PLAIN_COMPARISON_TITLE, PLAIN_NOT_SAID } from '@shared/reportProse.mjs';
import { compare, describeDifference } from '@/lib/ipmvp';
import { formatPeriod, getDevicePeriodReports, type PeriodBuildingReport, type PeriodDeviceReport, type ReportPeriod } from '@/lib/supabaseReports';

/**
 * One period against another, in the IPMVP Option C shape.
 *
 * Option C is a whole-facility method: you take the meter, you take the two periods, and you
 * difference them. What makes it a protocol rather than a subtraction is the adjustment for the
 * independent variables — and **this system records none of them**. So the difference is shown
 * with the list of what it was not adjusted for permanently beside it, and refused outright when
 * the two periods were not watched equally.
 *
 * THAT REFUSAL IS THE FEATURE. Today's live data makes it concrete: the week of 2026-08-31 is
 * 100% covered and August 2026 is 48%. Differenced without a gate that reads "−52%", which is
 * the most quotable number the page could produce and is entirely an artefact of the meters
 * being off. `src/lib/ipmvp.ts` decides; this only renders what it decided.
 */

interface Props {
  period: ReportPeriod;
  periods: readonly PeriodBuildingReport[];
  /** The period the rest of the page is showing — the reporting period by default. */
  selected: string | null;
  /**
   * RM-154: the period being read, with its energy as the sum of its circuits — the figure the Overview prints.
   * The earlier period is read the same way, from its own circuits, once it is chosen.
   */
  reporting?: PeriodBuildingReport | null;
  /** How an earlier period's circuits are read; the page's own reader by default. */
  loadRows?: (period: ReportPeriod, start: string) => Promise<PeriodDeviceReport[]>;
  /**
   * RM-154: this period against its projected baseline, offered as a choice beside the earlier periods.
   * Absent when the site has no baseline.
   */
  againstBaseline?: { status: 'idle' | 'loading' | 'ready' | 'error'; comparison: BaselineComparison | null; error?: string | null } | null;
  /** Open on the baseline rather than on "choose" — what a reader in Baseline mode came to see. */
  startOnBaseline?: boolean;
}

const BASELINE = '__baseline';
/** Module scope, so the effect that reads an earlier period does not run again on every render. */
const readRows = (p: ReportPeriod, start: string) => getDevicePeriodReports(p, start);

export function ComparisonReport({
  period,
  periods,
  selected,
  reporting: reportingGiven,
  loadRows = readRows,
  againstBaseline = null,
  startOnBaseline = false,
}: Props) {
  const stored = useMemo(() => periods.find((p) => p.period_start.slice(0, 10) === selected) ?? null, [periods, selected]);
  const reporting = reportingGiven ?? stored;
  /** The baseline is the reader's choice, and it starts unset. Defaulting to "the one before"
   *  would put a number on screen that nobody asked for, in a report whose whole job is to be
   *  careful about what a number means. */
  const [baselineStart, setBaselineStart] = useState<string | null>(startOnBaseline && againstBaseline ? BASELINE : null);
  const onBaseline = baselineStart === BASELINE;
  const earlierStored = useMemo(
    () => (onBaseline ? null : (periods.find((p) => p.period_start.slice(0, 10) === baselineStart) ?? null)),
    [periods, baselineStart, onBaseline]
  );
  // RM-154: the earlier period by its own circuits, as the reporting one is. Until they arrive, nothing is shown.
  const [earlierRows, setEarlierRows] = useState<{ start: string; rows: PeriodDeviceReport[] | null } | null>(null);
  useEffect(() => {
    if (!earlierStored) return;
    let cancelled = false;
    const start = earlierStored.period_start.slice(0, 10);
    loadRows(period, start).then(
      (rows) => !cancelled && setEarlierRows({ start, rows }),
      () => !cancelled && setEarlierRows({ start, rows: null })
    );
    return () => {
      cancelled = true;
    };
  }, [earlierStored, period, loadRows]);
  const earlierReady = earlierStored !== null && earlierRows !== null && earlierRows.start === earlierStored.period_start.slice(0, 10);
  const baseline = useMemo(
    () => (earlierStored && earlierReady ? conservedBuilding(earlierStored, earlierRows?.rows ?? null) : null),
    [earlierStored, earlierReady, earlierRows]
  );

  const result = baseline && reporting ? compare({ baseline, reporting }) : null;

  return (
    <>
      <section className="devices-table-card reports-summary" aria-label="Period comparison">
        <h2 className="card-title">
          {reporting ? formatPeriod(period, reporting.period_start) : '—'} compared with an earlier {period}
        </h2>
        <label className="reports-picker">
          <span className="reports-picker__label">Earlier period</span>
          <select
            className="reports-picker__select"
            value={baselineStart ?? ''}
            onChange={(e) => setBaselineStart(e.target.value || null)}
          >
            <option value="">Choose an earlier {period}…</option>
            {againstBaseline ? <option value={BASELINE}>The baseline for this {period}</option> : null}
            {periods
              .filter((p) => p.period_start.slice(0, 10) !== selected)
              .map((p) => (
                <option key={p.period_start} value={p.period_start.slice(0, 10)}>
                  {formatPeriod(period, p.period_start)}
                </option>
              ))}
          </select>
        </label>

        {onBaseline ? null : earlierStored && !earlierReady ? (
          <p className="reports-note">Loading {formatPeriod(period, earlierStored.period_start)}…</p>
        ) : result === null ? (
          <p className="reports-note">
            Choose an earlier {period} to compare {reporting ? formatPeriod(period, reporting.period_start) : 'this period'} with.
          </p>
        ) : result.comparable ? (
          <>
            <dl className="reports-summary__grid">
              <div>
                <dt>Earlier</dt>
                <dd>{result.baselineKwh.toFixed(2)} kWh</dd>
              </div>
              <div>
                <dt>This {period}</dt>
                <dd>{result.reportingKwh.toFixed(2)} kWh</dd>
              </div>
              <div>
                <dt>Difference</dt>
                {/* The direction is in words as well as in the sign. A minus in front of a number
                    a reader hopes is good gets read as whichever they were hoping for. */}
                <dd>
                  {result.differenceKwh > 0 ? '+' : ''}
                  {result.differenceKwh.toFixed(2)} kWh
                  {result.differencePct === null ? null : (
                    <span className="reports-figure__caveat">
                      {' '}
                      ({result.differencePct > 0 ? '+' : ''}
                      {result.differencePct.toFixed(1)}%)
                    </span>
                  )}
                </dd>
              </div>
            </dl>
            <p className="reports-note">{describeDifference(result, period)}</p>
          </>
        ) : (
          // Not an error state and not styled as one: a refusal is the correct answer here, and
          // dressing it in red would read as something having gone wrong with the system.
          <p className="reports-note" role="note">
            <strong>Not comparable.</strong> {result.reason}
          </p>
        )}
      </section>

      {onBaseline && againstBaseline ? (
        againstBaseline.comparison ? (
          <AgainstBaseline c={againstBaseline.comparison} period={period} label={reporting ? formatPeriod(period, reporting.period_start) : 'This period'} />
        ) : (
          <p className="reports-note">{againstBaseline.status === 'error' ? `The baseline could not be loaded: ${againstBaseline.error ?? 'unknown error'}` : 'Working out the baseline…'}</p>
        )
      ) : null}

      <ReportCaveats title={PLAIN_COMPARISON_TITLE} items={PLAIN_COMPARISON_LIMITS} />
      <ReportCaveats title={NOT_SAID_TITLE} items={PLAIN_NOT_SAID} />
    </>
  );
}
