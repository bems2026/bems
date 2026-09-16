import { coverageOf } from '@/lib/supabaseReports';
import type { DemandSummary } from '@/lib/reportSeries';

/**
 * How much of the period was actually recorded — RM-072g, said plainly by RM-097.
 *
 * Every figure on the page is a claim about these minutes, so they are never hidden: the heading's badge
 * and the "Recorded" tile say the share up front, and this panel holds the detail behind it.
 *
 * TWO COUNTS, ON PURPOSE. "Minutes recorded" is minutes that carried a real reading. The meters also send
 * rows while reading nothing — 2026-08-18 has 1,414 of them and not one reading — and the stored reports
 * count those rows. Both are shown, so the page never quietly swaps one for the other.
 */

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');

/** Where the figures came from, in words a reader can act on. */
const RESOLUTION_NOTE: Record<string, string> = {
  minute: 'Made from minute-by-minute readings.',
  mixed: 'Older days are hourly averages, which can hide short peaks.',
  hour: 'Made from hourly averages, which can hide short peaks.',
};

interface Props {
  summary: DemandSummary | null;
  observedDays: number;
  completeDays: number;
  label: string;
  /** Shown as a collapsible panel under a one-line summary — RM-096's Overview. */
  collapsible?: boolean;
}

export function CoverageBanner({ summary, observedDays, completeDays, label, collapsible = false }: Props) {
  if (!summary) return null;
  const usable = coverageOf(summary.usable_minutes, summary.expected_minutes);
  const tone = usable?.band === 'complete' ? 'good' : usable?.band === 'partial' ? 'warn' : 'bad';
  const share = pct(summary.usable_minutes, summary.expected_minutes);

  const body = (
    <>
      <dl className="reports-summary__grid">
        <div>
          <dt>Minutes recorded</dt>
          <dd>
            {summary.usable_minutes.toLocaleString(undefined)} of {summary.expected_minutes.toLocaleString(undefined)}{' '}
            <span className="reports-figure__caveat">({share})</span>
          </dd>
        </div>
        <div>
          <dt>Minutes the meters sent, including empty ones</dt>
          <dd>
            {summary.observed_minutes.toLocaleString(undefined)}{' '}
            <span className="reports-figure__caveat">({pct(summary.observed_minutes, summary.expected_minutes)})</span>
          </dd>
        </div>
        <div>
          <dt>Longest gap</dt>
          <dd>
            {summary.longest_gap_minutes === null ? (
              <span className="reports-figure reports-figure--missing">—</span>
            ) : (
              `${Math.round(summary.longest_gap_minutes).toLocaleString(undefined)} min`
            )}
          </dd>
        </div>
        <div>
          <dt>Days recorded</dt>
          <dd>
            {observedDays} <span className="reports-figure__caveat">({completeDays} in full)</span>
          </dd>
        </div>
      </dl>
      {summary.resolution && RESOLUTION_NOTE[summary.resolution] ? <p className="reports-note">{RESOLUTION_NOTE[summary.resolution]}</p> : null}
    </>
  );

  if (collapsible) {
    return (
      <details className="devices-table-card reports-summary report-recorded" aria-label={`How much was recorded for ${label}`}>
        <summary className="report-recorded__summary">
          How much was recorded <span className={`badge badge--${tone}`}>{share} recorded</span>
        </summary>
        {body}
      </details>
    );
  }

  return (
    <section className="devices-table-card reports-summary" aria-label={`How much was recorded for ${label}`}>
      <h2 className="card-title">
        How much was recorded <span className={`badge badge--${tone}`}>{share} recorded</span>
      </h2>
      <p className="reports-note">Every figure in this report comes from these minutes.</p>
      {body}
    </section>
  );
}
