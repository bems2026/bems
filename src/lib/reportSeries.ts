import { supabase } from '@/config/supabase';
import { SITE } from '@shared/siteConfig.mjs';
import { assertNotTruncated } from './supabaseHistory';
import { coverageOf, type ReportPeriod } from './supabaseReports';
import type { DailyEnergyPoint } from '@/components/reports/charts/dailyEnergyChart';
import type { HourProfilePoint } from '@/components/reports/charts/loadProfileChart';
import type { HeatCell } from '@/components/reports/charts/demandHeatmapChart';
import type { DurationPoint } from '@/components/reports/charts/durationCurveChart';

/**
 * The client for phase37's series functions — the shape behind the reports' charts.
 *
 * READ-ONLY, like everything else the Reports page touches. Nothing in the browser generates a
 * report; these functions are `security invoker` and granted to `authenticated` only, so RLS
 * applies to the caller exactly as it would to a direct select.
 *
 * THE DISTINCTION THESE MAPPERS EXIST TO PRESERVE. Every bucketed row carries two counts:
 * `sample_count` is rows, `usable_sample_count` is rows holding a real reading. On 2026-08-18
 * the live project has 1,414 of the first and **zero** of the second — the meters wrote on
 * schedule while observing nothing, and the energy counter sat frozen. A mapper that reaches for
 * the wrong one hands the chart a fully observed day that used no electricity, and every honesty
 * rule downstream is then keeping a promise about the wrong number.
 *
 * The mappers are pure and exported separately from the I/O, the same split
 * `supabaseHistory.mapReadingsRows` makes and for the same reason: they are the part worth
 * testing, and they should not need a live project to test.
 */

const TZ = SITE.timezone;

/** phase37's own cap. `report_hour_matrix` raises above this rather than letting PostgREST
 *  truncate at 1000 in silence — the failure `phase9_history_buckets.sql` was written for. */
export const MAX_MATRIX_CELLS = 900;

export interface DailyRow {
  local_day: string;
  energy_kwh: number | null;
  peak_power_w: number | null;
  avg_power_w: number | null;
  sample_count: number;
  usable_sample_count: number;
  expected_samples: number;
  first_seen_minute: number | null;
  last_seen_minute: number | null;
  resolution: string | null;
}

export interface HourRow {
  local_hour: number;
  n: number;
  p50_w: number | null;
  p95_w: number | null;
  max_w: number | null;
  resolution: string | null;
}

export interface MatrixRow {
  local_day: string;
  local_hour: number;
  avg_power_w: number | null;
  max_power_w: number | null;
  sample_count: number;
  usable_sample_count: number;
  resolution: string | null;
}

export interface CurveRow {
  pct: number;
  power_w: number | null;
  resolution: string | null;
}

export interface DemandSummary {
  n: number;
  p50_w: number | null;
  p95_w: number | null;
  p99_w: number | null;
  max_w: number | null;
  min_w: number | null;
  observed_minutes: number;
  usable_minutes: number;
  expected_minutes: number;
  longest_gap_minutes: number | null;
  resolution: string | null;
}

// --- pure mappers ---------------------------------------------------------------------------

export function toDailyPoints(rows: readonly DailyRow[]): DailyEnergyPoint[] {
  return rows.map((r) => ({
    // A bare date the SQL already resolved in the building's own zone. Kept as written and
    // sliced, never parsed into an instant and re-formatted — that would shift it by the
    // reader's offset, which is the trap `supabaseReports.formatMonth` documents.
    day: r.local_day.slice(0, 10),
    label: String(Number(r.local_day.slice(8, 10))),
    kwh: r.energy_kwh,
    observed: r.usable_sample_count > 0,
    // `coverageOf` owns where "complete" begins. A second threshold here would drift from the
    // one the figures printed beside the chart are qualified by.
    complete: coverageOf(r.usable_sample_count, r.expected_samples)?.band === 'complete',
  }));
}

export function toHourPoints(rows: readonly HourRow[]): HourProfilePoint[] {
  return [...rows]
    .sort((a, b) => a.local_hour - b.local_hour)
    .map((r) => ({ hour: r.local_hour, n: r.n, p50: r.p50_w, p95: r.p95_w, max: r.max_w }));
}

export function toHeatCells(rows: readonly MatrixRow[]): HeatCell[] {
  return rows.map((r) => ({
    day: r.local_day.slice(0, 10),
    hour: r.local_hour,
    // Both conditions, deliberately. They ought to agree, and where they do not the absent
    // number wins: a cell painted from an average whose samples carried nothing is a colour
    // from the ramp, and the ramp means "this much demand".
    value: r.usable_sample_count > 0 ? r.avg_power_w : null,
  }));
}

export function toDurationPoints(rows: readonly CurveRow[]): DurationPoint[] {
  return [...rows].sort((a, b) => a.pct - b.pct).map((r) => ({ pct: r.pct, w: r.power_w }));
}

// --- I/O ------------------------------------------------------------------------------------

function client() {
  if (!supabase) {
    throw new Error('Supabase is not configured — the report series are stored there.');
  }
  return supabase;
}

async function call<T>(fn: string, args: Record<string, unknown>, cap: number): Promise<T[]> {
  const { data, error } = await client().rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  const rows = (data ?? []) as T[];
  // Every one of these returns a bounded count by construction, so hitting the cap means the
  // answer was cut rather than that the period was large — and a cut series draws a
  // complete-looking chart. Loud beats quiet.
  return assertNotTruncated(rows, cap, `${fn}(${JSON.stringify(args)})`);
}

const window = (period: ReportPeriod, start: string) => ({
  p_period: period,
  p_start: start,
  // Passed explicitly rather than left to the SQL default: the client and the query must agree
  // about what a day is, and the default is only correct for the site that wrote it.
  p_tz: TZ,
});

export async function getDailySeries(period: ReportPeriod, start: string): Promise<DailyRow[]> {
  // 31 days at most; 40 leaves room for a period type longer than a month without tripping.
  return call<DailyRow>('report_daily_series', window(period, start), 40);
}

export async function getHourProfile(period: ReportPeriod, start: string): Promise<HourRow[]> {
  return call<HourRow>('report_hour_profile', window(period, start), 25);
}

export async function getHourMatrix(period: ReportPeriod, start: string): Promise<MatrixRow[]> {
  return call<MatrixRow>('report_hour_matrix', window(period, start), MAX_MATRIX_CELLS + 1);
}

export async function getDemandCurve(period: ReportPeriod, start: string): Promise<CurveRow[]> {
  return call<CurveRow>('report_demand_curve', window(period, start), 502);
}

export async function getDemandSummary(period: ReportPeriod, start: string): Promise<DemandSummary | null> {
  const rows = await call<DemandSummary>('report_demand_summary', window(period, start), 2);
  return rows[0] ?? null;
}
