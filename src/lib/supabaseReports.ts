/**
 * Monthly energy reports — reads the rows `generate_monthly_report` stores
 * (`supabase/phase12_monthly_reports.sql`). Read-only; nothing in the browser generates a
 * report, and RLS grants `authenticated` select and nothing else.
 *
 * WHY COVERAGE TRAVELS WITH EVERY FIGURE:
 * a device that was offline for most of a month still produces a real, small, confident
 * kWh number. Presenting it without saying how much of the month was actually observed is
 * the same failure Phase 9 fixed on the charts — a plausible answer that is silently wrong.
 * Every consumer of this module is expected to render `coverageOf()` next to the value, and
 * `ReportsPage` does. This matters acutely right now: the field devices have been offline
 * since 2026-08-20 (ROADMAP RM-001), so recent months are mostly gap.
 */

import { supabase } from '@/config/supabase';
import { SITE } from '@shared/siteConfig.mjs';

export interface MonthlyDeviceReport {
  month: string;
  device_id: string;
  energy_kwh: number | null;
  peak_power_w: number | null;
  avg_power_w: number | null;
  online_sample_count: number;
  expected_sample_count: number;
}

export interface MonthlyBuildingReport {
  month: string;
  energy_kwh: number | null;
  peak_total_power_w: number | null;
  avg_voltage: number | null;
  phase_current_red_avg: number | null;
  phase_current_yellow_avg: number | null;
  phase_current_blue_avg: number | null;
  command_count: number;
  command_count_manual: number;
  command_count_schedule: number;
  command_count_autoshed: number;
  anomaly_count: number;
  online_sample_count: number;
  expected_sample_count: number;
  generated_at: string;
}

export type CoverageBand = 'complete' | 'partial' | 'sparse' | 'none';

export interface Coverage {
  ratio: number;
  band: CoverageBand;
}

/**
 * Pure. What fraction of the month was actually observed, and how much that figure can carry.
 *
 * Returns `null` — not zero — when the expected count is missing or zero, because "we cannot
 * say" and "we saw nothing" are different facts, and only one of them is a measurement.
 *
 * The bands are deliberately conservative. `partial` starts at half a month because a figure
 * derived from less than that should never be quoted as the month's consumption without the
 * caveat attached, and `complete` demands 95% rather than 100% because the ingest daemon
 * restarts, and a handful of missed minutes across a month is not a gap worth flagging.
 */
export function coverageOf(onlineSamples: number, expectedSamples: number): Coverage | null {
  if (!Number.isFinite(expectedSamples) || expectedSamples <= 0) return null;
  if (!Number.isFinite(onlineSamples) || onlineSamples < 0) return null;
  const ratio = Math.min(onlineSamples / expectedSamples, 1);
  if (ratio >= 0.95) return { ratio, band: 'complete' };
  if (ratio >= 0.5) return { ratio, band: 'partial' };
  if (ratio > 0) return { ratio, band: 'sparse' };
  return { ratio: 0, band: 'none' };
}

/** Pure. Whether a figure from this coverage may be presented as the month's answer without
 * a caveat beside it. Only `complete` may. */
export function isQuotable(coverage: Coverage | null): boolean {
  return coverage?.band === 'complete';
}

/**
 * Pure. `2026-07-01` -> `July 2026`, without pulling a date library in for one format.
 *
 * `timeZone: 'UTC'` is right here and is NOT the mistake `src/lib/siteTime.ts` exists for. This
 * formats a bare DATE STRING, not an instant: the value is constructed at UTC midnight, so
 * pinning UTC is what stops a reader west of the meridian seeing `2026-07-01` labelled "June".
 * The locale is the reader's, because how a month is spelled is theirs and not this building's.
 */
export function formatMonth(month: string): string {
  const [y, m] = month.slice(0, 10).split('-');
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  if (Number.isNaN(date.getTime())) return month;
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function requireSupabase() {
  if (!supabase) {
    throw new Error('Reports need stored history, which this deployment has not configured.');
  }
  return supabase;
}

/** Every month that has a generated report, newest first. Explicitly bounded — PostgREST
 * caps silently, and this project has been bitten by inferring completeness from a response
 * that had no way to signal truncation. */
export async function getReportMonths(): Promise<MonthlyBuildingReport[]> {
  const { data, error } = await requireSupabase()
    .from('monthly_building_reports')
    .select('*')
    .order('month', { ascending: false })
    .limit(240);
  if (error) throw new Error(`Could not list reports: ${error.message}`);
  return (data ?? []) as MonthlyBuildingReport[];
}

/** The per-device rows for one month. At most one row per device, so the device count is the
 * natural bound. */
export async function getDeviceReports(month: string): Promise<MonthlyDeviceReport[]> {
  const { data, error } = await requireSupabase()
    .from('monthly_reports')
    .select('*')
    .eq('month', month)
    .order('energy_kwh', { ascending: false, nullsFirst: false })
    .limit(500);
  if (error) throw new Error(`Could not load the report for ${month}: ${error.message}`);
  return (data ?? []) as MonthlyDeviceReport[];
}

/**
 * Which period a report covers — RM-041.
 *
 * A WEEK IS ITS MONDAY, because `date_trunc('week')` and ISO-8601 both say so, and because the
 * generator truncates whatever date it is given. Two callers passing different days of the same
 * week write the same row.
 */
export type ReportPeriod = 'day' | 'week' | 'month';

/** The page's words for a kind of period: `Daily`, `Weekly`, `Monthly` — RM-124 made it three. */
export const PERIOD_ADJECTIVE: Record<ReportPeriod, string> = { day: 'Daily', week: 'Weekly', month: 'Monthly' };

export interface PeriodDeviceReport {
  period: ReportPeriod;
  period_start: string;
  device_id: string;
  energy_kwh: number | null;
  peak_power_w: number | null;
  avg_power_w: number | null;
  online_sample_count: number;
  expected_sample_count: number;
  /**
   * kWh of a counter jump the stored figure does not count — RM-091, phase42. Absent before phase42 is
   * applied (the columns do not exist, and `select *` simply omits them), null when nothing was removed.
   */
  energy_removed_kwh?: number | null;
  /** When phase42's one-time correction rewrote this row's energy; null for a row generated with the rule. */
  energy_restated_at?: string | null;
}

export interface PeriodBuildingReport {
  period: ReportPeriod;
  period_start: string;
  energy_kwh: number | null;
  peak_total_power_w: number | null;
  avg_voltage: number | null;
  phase_current_red_avg: number | null;
  phase_current_yellow_avg: number | null;
  phase_current_blue_avg: number | null;
  command_count: number;
  command_count_manual: number;
  command_count_schedule: number;
  command_count_autoshed: number;
  anomaly_count: number;
  online_sample_count: number;
  expected_sample_count: number;
  generated_at: string;
  /** phase44 (RM-073): what `online_sample_count` said before it was recounted, and when. Absent before phase44. */
  online_sample_count_before?: number | null;
  coverage_restated_at?: string | null;
}

export interface CoverageRestatement {
  /** The share the report used to print, and the share it prints now — whole percent. */
  was: number;
  now: number;
  text: string;
}

/**
 * Pure. RM-073 — what a restated report used to say, or `null` when there is nothing a reader would notice.
 *
 * phase44 recounted every stored report's Recorded figure in minutes that hold a reading. Until then it
 * counted rows, and a meter that stopped observing kept writing rows: the week of 2026-08-17 was stored
 * as 98% and held a reading in 16% of its minutes. The operator decided the stored figures are restated
 * WITH a note, so the page and the PDF say so beside the figure. A recount that leaves the whole percent
 * where it was — a restart's extra minute — is not worth a note.
 */
export function coverageRestatement(row: {
  online_sample_count: number;
  expected_sample_count: number;
  online_sample_count_before?: number | null;
  coverage_restated_at?: string | null;
}): CoverageRestatement | null {
  const { online_sample_count: now, expected_sample_count: expected, online_sample_count_before: before, coverage_restated_at: at } = row;
  if (!at || typeof before !== 'number' || !(expected > 0)) return null;
  const was = Math.round((before / expected) * 100);
  const is = Math.round((now / expected) * 100);
  if (was === is) return null;
  const when = new Date(at);
  const on = Number.isNaN(when.getTime())
    ? at.slice(0, 10)
    : when.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: SITE.timezone });
  return { was, now: is, text: `Recorded share corrected on ${on}: this report said ${was}%, counting rows the meters sent with no reading in them.` };
}

/**
 * Pure. How a period reads in a list: `July 2026`, or `Mon 6 Jul 2026` for the week starting
 * then.
 *
 * `timeZone: 'UTC'` for the same reason `formatMonth` pins it — this formats a bare DATE STRING,
 * not an instant, so without it a reader west of the meridian sees the day before. The locale is
 * the reader's, because how a date is spelled is theirs and not this building's.
 */
export function formatPeriod(period: ReportPeriod, start: string): string {
  if (period === 'month') return formatMonth(start);
  const [y, m, d] = start.slice(0, 10).split('-');
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (Number.isNaN(date.getTime())) return start;
  // A day carries its weekday — RM-124. "19 Sep" alone does not say it was a Saturday, and whether
  // the office was open is the first thing a reader of a day's report wants to know.
  if (period === 'day') return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  // "Week of" rather than a bare date: a list of Mondays with no label reads as a list of days
  // on which something happened.
  return `Week of ${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
}

/** Every period of this kind that has a generated report, newest first. Explicitly bounded —
 * PostgREST caps silently, and this project has been bitten by inferring completeness from a
 * response that had no way to signal truncation. 240 months is 20 years; 240 weeks is under 5,
 * so weeks get their own, larger bound rather than sharing one that means different things.
 * 400 days is thirteen months — a day's report is read for what happened, not for a trend. */
export async function getReportPeriods(period: ReportPeriod, { signal }: { signal?: AbortSignal } = {}): Promise<PeriodBuildingReport[]> {
  let query = requireSupabase()
    .from('period_building_reports')
    .select('*')
    .eq('period', period)
    .order('period_start', { ascending: false })
    .limit(period === 'week' ? 520 : period === 'day' ? 400 : 240);
  // RM-081: a caller that times out cancels the request itself, not just its wait for it.
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw new Error(`Could not list reports: ${error.message}`);
  return (data ?? []) as PeriodBuildingReport[];
}

/** The per-device rows for one period. At most one row per device, so the device count is the
 * natural bound. */
export async function getDevicePeriodReports(
  period: ReportPeriod,
  start: string,
  { signal }: { signal?: AbortSignal } = {}
): Promise<PeriodDeviceReport[]> {
  let query = requireSupabase()
    .from('period_reports')
    .select('*')
    .eq('period', period)
    .eq('period_start', start)
    .order('energy_kwh', { ascending: false, nullsFirst: false })
    .limit(500);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load the ${period} report starting ${start}: ${error.message}`);
  return (data ?? []) as PeriodDeviceReport[];
}
