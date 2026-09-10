import { useMemo, useState } from 'react';
import { ReportCaveats } from './ReportCaveats';
import { COMPARISON_NOT_ADJUSTED, NOT_SAID, NOT_SAID_TITLE } from '@shared/reportProse.mjs';
import { compare, describeDifference } from '@/lib/ipmvp';
import { formatPeriod, type PeriodBuildingReport, type ReportPeriod } from '@/lib/supabaseReports';

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
}

export function ComparisonReport({ period, periods, selected }: Props) {
  const reporting = useMemo(
    () => periods.find((p) => p.period_start.slice(0, 10) === selected) ?? null,
    [periods, selected]
  );
  /** The baseline is the reader's choice, and it starts unset. Defaulting to "the one before"
   *  would put a number on screen that nobody asked for, in a report whose whole job is to be
   *  careful about what a number means. */
  const [baselineStart, setBaselineStart] = useState<string | null>(null);
  const baseline = useMemo(
    () => periods.find((p) => p.period_start.slice(0, 10) === baselineStart) ?? null,
    [periods, baselineStart]
  );

  const result = baseline && reporting ? compare({ baseline, reporting }) : null;

  return (
    <>
      <section className="devices-table-card reports-summary" aria-label="Period comparison">
        <h2 className="card-title">
          {reporting ? formatPeriod(period, reporting.period_start) : '—'} against a baseline
        </h2>
        <label className="reports-picker">
          <span className="reports-picker__label">Baseline period</span>
          <select
            className="reports-picker__select"
            value={baselineStart ?? ''}
            onChange={(e) => setBaselineStart(e.target.value || null)}
          >
            <option value="">Choose a baseline…</option>
            {periods
              .filter((p) => p.period_start.slice(0, 10) !== selected)
              .map((p) => (
                <option key={p.period_start} value={p.period_start.slice(0, 10)}>
                  {formatPeriod(period, p.period_start)}
                </option>
              ))}
          </select>
        </label>

        {result === null ? (
          <p className="reports-note">
            Choose a baseline period to compare {reporting ? formatPeriod(period, reporting.period_start) : 'this period'} against.
          </p>
        ) : result.comparable ? (
          <>
            <dl className="reports-summary__grid">
              <div>
                <dt>Baseline</dt>
                <dd>{result.baselineKwh.toFixed(2)} kWh</dd>
              </div>
              <div>
                <dt>Reporting</dt>
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

      <ReportCaveats title="What this comparison was not adjusted for" items={COMPARISON_NOT_ADJUSTED} />
      <ReportCaveats title={NOT_SAID_TITLE} items={NOT_SAID} />
    </>
  );
}
