import type { ReportPeriod } from './supabaseReports';

/**
 * Pure. The start of the same period one year earlier — RM-082b's "same month last year" jump.
 *
 * A month is the same month of the previous year. A WEEK IS 52 WEEKS BACK, 364 days, not a calendar
 * year: stored weeks start on a Monday, and 365 days back lands on a Tuesday that matches no stored
 * week, so the jump would always report that last year's week does not exist.
 *
 * Works on the bare date string in UTC, for the reason `formatMonth` gives: this is a date, not an
 * instant, and a reader west of the meridian must not see the day before.
 */
export function sameStartLastYear(period: ReportPeriod, start: string): string | null {
  const [y, m, d] = start.slice(0, 10).split('-').map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) || m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (period === 'month') return `${y - 1}-${String(m).padStart(2, '0')}-01`;
  const t = Date.UTC(y, m - 1, d) - 364 * 86_400_000;
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}
