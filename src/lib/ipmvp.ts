import { coverageOf, type Coverage, type PeriodBuildingReport, type ReportPeriod } from './supabaseReports';

/**
 * Comparing one period against another, in the IPMVP Option C shape — and refusing to when the
 * comparison would not mean anything.
 *
 * OPTION C IS A WHOLE-FACILITY METHOD AND IT REQUIRES ROUTINE ADJUSTMENT for the independent
 * variables. This system records none of them: no degree-days, no occupancy, no operating hours.
 * That does not make the arithmetic wrong; it makes an unqualified difference a claim the data
 * cannot support, which is why `shared/reportProse.mjs`'s `COMPARISON_NOT_ADJUSTED` is not
 * collapsible and this module refuses outright in two cases.
 *
 * THE REFUSALS ARE THE POINT.
 *
 *   1. A week against a month, in absolute kWh, is meaningless — and it is the easiest mistake to
 *      make on a page whose period switcher is two clicks away from either.
 *   2. **A difference between two periods of unequal coverage is not a difference in
 *      consumption.** With today's live data this is not hypothetical: the week of 2026-08-31 is
 *      100% covered and August 2026 is 48% covered as rows and 27% as real readings. An ungated
 *      comparison of the two would print something like "−52%" as the most quotable number in a
 *      document going to a university, and every part of it would be an artefact of the meters
 *      being off.
 *
 * So a difference is computed only when both periods are `complete`. Otherwise the result says
 * why not, and the page prints that instead of a number.
 */

export interface ComparisonInput {
  baseline: PeriodBuildingReport;
  reporting: PeriodBuildingReport;
}

export type Incomparable =
  | { comparable: false; reason: string }
  | { comparable: false; reason: string; baselineCoverage: Coverage | null; reportingCoverage: Coverage | null };

export interface Comparison {
  comparable: true;
  baselineKwh: number;
  reportingKwh: number;
  /** Reporting minus baseline. Negative means the reporting period used less. */
  differenceKwh: number;
  /** As a share of the baseline. Null when the baseline is zero — a percentage of nothing. */
  differencePct: number | null;
  baselineCoverage: Coverage;
  reportingCoverage: Coverage;
}

export type ComparisonResult = Comparison | Incomparable;

export function compare({ baseline, reporting }: ComparisonInput): ComparisonResult {
  if (baseline.period !== reporting.period) {
    return {
      comparable: false,
      reason: `A ${baseline.period} and a ${reporting.period} hold different numbers of hours, so their totals are not comparable in kilowatt-hours.`,
    };
  }
  if (baseline.period_start === reporting.period_start) {
    return { comparable: false, reason: 'The two periods are the same one.' };
  }

  const baselineCoverage = coverageOf(baseline.online_sample_count, baseline.expected_sample_count);
  const reportingCoverage = coverageOf(reporting.online_sample_count, reporting.expected_sample_count);

  const thin = [
    { label: 'baseline', c: baselineCoverage },
    { label: 'reporting', c: reportingCoverage },
  ].filter((x) => x.c?.band !== 'complete');

  if (thin.length > 0) {
    return {
      comparable: false,
      // Named, with its figure. "Not comparable" on its own invites the reader to assume a bug;
      // saying which period was watched, and how little, points at the building instead.
      reason:
        `The ${thin.map((x) => x.label).join(' and ')} period ${thin.length === 1 ? 'was' : 'were'} not fully observed ` +
        `(${thin.map((x) => `${x.label} ${x.c ? `${Math.round(x.c.ratio * 100)}%` : 'unknown'}`).join(', ')}). ` +
        'A difference between two periods of unequal coverage is a difference in how much was watched, not in how much was used.',
      baselineCoverage,
      reportingCoverage,
    };
  }

  if (baseline.energy_kwh === null || reporting.energy_kwh === null) {
    return {
      comparable: false,
      reason: 'One of the periods reports no energy at all, so there is nothing to difference.',
      baselineCoverage,
      reportingCoverage,
    };
  }

  const differenceKwh = reporting.energy_kwh - baseline.energy_kwh;
  return {
    comparable: true,
    baselineKwh: baseline.energy_kwh,
    reportingKwh: reporting.energy_kwh,
    differenceKwh,
    // A percentage of zero is not zero percent, it is undefined — and rendering it as ∞ or as
    // 0% would both be inventions.
    differencePct: baseline.energy_kwh === 0 ? null : (differenceKwh / baseline.energy_kwh) * 100,
    baselineCoverage: baselineCoverage as Coverage,
    reportingCoverage: reportingCoverage as Coverage,
  };
}

/** `used 12.3 kWh less` / `used 4.1 kWh more` — the direction said in words, because a minus
 *  sign in front of a number a reader wants to be good is read as whichever they expected. */
export function describeDifference(c: Comparison, period: ReportPeriod): string {
  const magnitude = Math.abs(c.differenceKwh);
  const pct = c.differencePct === null ? null : Math.abs(c.differencePct);
  const direction = c.differenceKwh < 0 ? 'less' : 'more';
  const pctText = pct === null ? '' : ` (${pct.toFixed(1)}%)`;
  if (c.differenceKwh === 0) return `The two ${period}s used the same energy to the kilowatt-hour.`;
  return `The reporting ${period} used ${magnitude.toFixed(2)} kWh${pctText} ${direction} than the baseline ${period}.`;
}
