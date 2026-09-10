import { ReportCaveats } from './ReportCaveats';
import { ReportCharts } from './ReportCharts';
import { CoverageBanner } from './CoverageBanner';
import {
  BASELINE_MIN_DAYS,
  BASELINE_MIN_SAMPLES,
  DEMAND_CAVEAT,
  NOT_A_BASELINE_TITLE,
  NOT_SAID,
  NOT_SAID_TITLE,
  notABaselineYet,
} from '@shared/reportProse.mjs';
import { formatPeriod, type ReportPeriod } from '@/lib/supabaseReports';
import type { ChartsData } from './ReportCharts';
import type { DemandSummary } from '@/lib/reportSeries';

/**
 * The baseline report — Milestone 1's "baseline energy dataset and benchmarking summary", on the
 * page rather than in a Markdown file nobody opens.
 *
 * `npm run baseline:report` has produced this content since FI-018 and writes it to a gitignored
 * folder on the Pi. The figures were never the problem; the reader was. This is the same claims,
 * from the same rules, rendered where the operator already is — and `shared/reportProse.mjs` is
 * what stops the two saying different things about the same limits.
 *
 * THE ORDER IS THE ARGUMENT. Coverage first, because every figure after it is a claim about the
 * hours in that table and not about the hours in the window. Then the "not a baseline yet" gate,
 * which fires on the window's own thinness rather than on anything the reader chose. Only then
 * the numbers.
 */

interface Props {
  period: ReportPeriod;
  start: string;
  summary: DemandSummary | null;
  charts: ChartsData;
}

const w = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${Math.round(v).toLocaleString(undefined)} W`;

export function BaselineReport({ period, start, summary, charts }: Props) {
  const label = formatPeriod(period, start);
  const observedDays = charts.daily.filter((d) => d.usable_sample_count > 0).length;
  const completeDays = charts.daily.filter(
    (d) => d.expected_samples > 0 && d.usable_sample_count / d.expected_samples >= 0.95
  ).length;

  /**
   * The gate. It counts REAL READINGS and days that actually held one — not rows, and not days a
   * meter wrote through while observing nothing. Counting rows would let a fortnight of frozen
   * counters promote a sample to a benchmark, which is the exact shape 2026-08-18 has.
   */
  const thin =
    summary === null ||
    summary.usable_minutes < BASELINE_MIN_SAMPLES ||
    observedDays < BASELINE_MIN_DAYS;

  return (
    <>
      <CoverageBanner
        summary={summary}
        observedDays={observedDays}
        completeDays={completeDays}
        label={label}
      />

      {thin ? (
        <section className="reports-summary devices-table-card report-thin" role="note" aria-label={NOT_A_BASELINE_TITLE}>
          <h2 className="card-title">{NOT_A_BASELINE_TITLE}</h2>
          {notABaselineYet(summary?.usable_minutes ?? 0, observedDays).map((line) => (
            <p key={line} className="reports-note">
              {line}
            </p>
          ))}
        </section>
      ) : null}

      <section className="devices-table-card reports-summary" aria-label={`Demand for ${label}`}>
        <h2 className="card-title">Demand</h2>
        <dl className="reports-summary__grid">
          <div>
            <dt>Median (p50)</dt>
            <dd>{w(summary?.p50_w)}</dd>
          </div>
          <div>
            <dt>p95</dt>
            <dd>{w(summary?.p95_w)}</dd>
          </div>
          <div>
            <dt>p99</dt>
            <dd>{w(summary?.p99_w)}</dd>
          </div>
          <div>
            <dt>Observed peak</dt>
            <dd>{w(summary?.max_w)}</dd>
          </div>
        </dl>
        <p className="reports-note">{DEMAND_CAVEAT}</p>
      </section>

      <ReportCharts period={period} start={start} {...charts} />

      <ReportCaveats title={NOT_SAID_TITLE} items={NOT_SAID} />
    </>
  );
}
