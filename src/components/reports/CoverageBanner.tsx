import { COVERAGE_LEDE } from '@shared/reportProse.mjs';
import { coverageOf } from '@/lib/supabaseReports';
import type { DemandSummary } from '@/lib/reportSeries';

/**
 * Coverage, before anything it qualifies.
 *
 * The ordering is the claim. `server/baselineReport.mjs` puts it first and says why in one
 * sentence — every figure after it is about the hours in this table, not about the hours in the
 * window — and a report that leads with a total and footnotes the coverage has said the
 * quotable thing first.
 *
 * TWO COVERAGE FIGURES, NOT ONE, and that is RM-072g. `observed_minutes` counts rows;
 * `usable_minutes` counts rows that hold a real reading. For August 2026 those are 48% and 27%,
 * because 9,415 of the month's rows were written by meters that observed nothing. Showing only
 * the first overstates by twenty-one points; showing only the second would disagree with the
 * figure the stored report prints. Both, named.
 *
 * RESOLUTION SITS HERE TOO. `building_totals` is pruned at 30 days, so an old period's
 * percentiles come from hourly means — a different statistic, systematically low, with no error
 * and no event to mark the transition. It is qualified beside the coverage it belongs with.
 */

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');

const RESOLUTION_NOTE: Record<string, string> = {
  minute: 'from minute-by-minute samples',
  mixed: 'partly from minute samples and partly from hourly averages, because the raw rows for the older part of this period have been rolled up',
  hour: 'from hourly averages only — the minute-by-minute rows behind this period have been rolled up, and an average cannot reach the peaks the samples had',
};

interface Props {
  summary: DemandSummary | null;
  observedDays: number;
  completeDays: number;
  label: string;
}

export function CoverageBanner({ summary, observedDays, completeDays, label }: Props) {
  if (!summary) return null;
  const usable = coverageOf(summary.usable_minutes, summary.expected_minutes);
  const tone = usable?.band === 'complete' ? 'good' : usable?.band === 'partial' ? 'warn' : 'bad';

  return (
    <section className="devices-table-card reports-summary" aria-label={`Coverage for ${label}`}>
      <h2 className="card-title">
        Coverage <span className={`badge badge--${tone}`}>{pct(summary.usable_minutes, summary.expected_minutes)} observed</span>
      </h2>
      <p className="reports-note">{COVERAGE_LEDE}</p>
      <dl className="reports-summary__grid">
        <div>
          <dt>Minutes with a real reading</dt>
          <dd>
            {summary.usable_minutes.toLocaleString(undefined)} of {summary.expected_minutes.toLocaleString(undefined)}{' '}
            <span className="reports-figure__caveat">({pct(summary.usable_minutes, summary.expected_minutes)})</span>
          </dd>
        </div>
        <div>
          <dt>Minutes with a row of any kind</dt>
          {/* The gap between this and the line above is meters writing while observing nothing.
              It is the figure the stored period report counts, so both are shown rather than
              silently substituting one for the other. */}
          <dd>
            {summary.observed_minutes.toLocaleString(undefined)}{' '}
            <span className="reports-figure__caveat">({pct(summary.observed_minutes, summary.expected_minutes)})</span>
          </dd>
        </div>
        <div>
          <dt>Longest single gap</dt>
          <dd>
            {summary.longest_gap_minutes === null ? (
              <span className="reports-figure reports-figure--missing">—</span>
            ) : (
              `${Math.round(summary.longest_gap_minutes).toLocaleString(undefined)} min`
            )}
          </dd>
        </div>
        <div>
          <dt>Days observed</dt>
          <dd>
            {observedDays} <span className="reports-figure__caveat">({completeDays} of them complete)</span>
          </dd>
        </div>
      </dl>
      {summary.resolution && RESOLUTION_NOTE[summary.resolution] ? (
        <p className="reports-note">
          The figures in this report are computed {RESOLUTION_NOTE[summary.resolution]}.
        </p>
      ) : null}
    </section>
  );
}
