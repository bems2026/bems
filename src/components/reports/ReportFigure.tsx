import { isQuotable, type Coverage, type ReportPeriod } from '@/lib/supabaseReports';

/**
 * A figure with its qualifier on the same line, and the coverage badge that goes beside it.
 *
 * Moved out of `ReportsPage` by RM-082, because the headline row, the device table and the circuit
 * tables all print figures now — and three copies of "never without the qualifier attached" is how
 * one of them would lose it.
 */

/** Tones reuse the shared `.badge--*` modifiers rather than introducing new colour values,
 * per CLAUDE.md: those four are already contrast-checked in both themes, and a fifth pair
 * invented here would be the first thing to fail an audit. */
const COVERAGE_TONE: Record<Coverage['band'], { label: string; tone: string }> = {
  complete: { label: 'Complete', tone: 'good' },
  partial: { label: 'Partial', tone: 'warn' },
  sparse: { label: 'Sparse', tone: 'bad' },
  none: { label: 'No data', tone: 'bad' },
};

/** Period-aware — a weekly report used to describe itself as a month (RM-081). */
function coverageNote(band: Coverage['band'], period: ReportPeriod): string {
  switch (band) {
    case 'complete':
      return `the whole ${period} was observed`;
    case 'partial':
      return `over half the ${period} was observed — this total is understated`;
    case 'sparse':
      return `only a fraction of the ${period} was observed — this total is not the ${period}’s consumption`;
    case 'none':
      return `the ${period} passed with nothing recorded`;
  }
}

export function CoverageTag({ coverage, period }: { coverage: Coverage | null; period: ReportPeriod }) {
  // "Unknown" is not "none": one means the period recorded nothing, the other means we cannot
  // even say what full coverage would have been. Neutral badge, no tone.
  if (!coverage) return <span className="badge">Coverage unknown</span>;
  const copy = COVERAGE_TONE[coverage.band];
  return (
    <span className={`badge badge--${copy.tone}`} title={coverageNote(coverage.band, period)}>
      {copy.label} · {Math.round(coverage.ratio * 100)}%
    </span>
  );
}

/**
 * A figure the report cannot stand behind is still shown — hiding it would be its own kind of
 * dishonesty — but never without the qualifier attached to the same line.
 *
 * `notObserved` is the exception, and it is not hiding a figure: it is refusing to print one that
 * was never measured. Live, the week of 2026-08-10 is stored as 0 kWh from 10 of 10,080 samples,
 * none of them a real reading — and "0.00 kWh" says that week used no electricity.
 *
 * `unit` may be empty where a table already says the unit in its header.
 */
export function ReportFigure({
  value,
  unit,
  digits = 1,
  coverage,
  period,
  notObserved = false,
}: {
  value: number | null;
  unit: string;
  digits?: number;
  coverage?: Coverage | null;
  period: ReportPeriod;
  notObserved?: boolean;
}) {
  if (notObserved) {
    return <span className="reports-figure reports-figure--missing">— not observed</span>;
  }
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className="reports-figure reports-figure--missing">—</span>;
  }
  const qualified = coverage !== undefined && !isQuotable(coverage);
  return (
    <span className={`reports-figure${qualified ? ' reports-figure--qualified' : ''}`}>
      {value.toFixed(digits)}
      {unit ? ` ${unit}` : null}
      {qualified ? <span className="reports-figure__caveat"> (partial {period})</span> : null}
    </span>
  );
}
