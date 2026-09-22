import { supabase } from '@/config/supabase';
import { SITE } from '@shared/siteConfig.mjs';
import { assertNotTruncated } from './supabaseHistory';
import { coverageOf, type ReportPeriod } from './supabaseReports';
import { ReportQueryError } from './reportLoader';
import type { DailyEnergyPoint } from '@/components/reports/charts/dailyEnergyChart';
import type { HourProfilePoint } from '@/components/reports/charts/loadProfileChart';
import type { HeatCell } from '@/components/reports/charts/demandHeatmapChart';
import type { DurationPoint } from '@/components/reports/charts/durationCurveChart';
import type { HourlyEnergyPoint } from '@/components/reports/charts/hourlyEnergyChart';

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

/** One device's one local hour, as `report_hour_energy` (phase46) returns it. */
export interface HourEnergyRow {
  device_id: string;
  local_day: string;
  local_hour: number;
  /** Credited by phase42's rule; null when the hour carried no counter. */
  energy_kwh: number | null;
  clipped: boolean;
  avg_power_w: number | null;
  max_power_w: number | null;
  online_minutes: number;
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

/**
 * The summary with its minute counts held to the period's length.
 *
 * `report_demand_summary` counts ROWS in `building_totals`, and a row is not always its own minute:
 * every ingest restart runs a cycle at once, inside the minute the last scheduled tick already wrote,
 * so each restart adds a second row to one minute. The week of 2026-09-07 held 10,082 rows in 10,074
 * distinct minutes, and the page said "10,082 of 10,080 minutes". The database is corrected to count
 * distinct minutes by phase44; until then, and after it as a guard, no period records more minutes
 * than it has.
 */
export function toDemandSummary(row: DemandSummary): DemandSummary {
  const cap = (minutes: number) => (row.expected_minutes > 0 ? Math.min(minutes, row.expected_minutes) : minutes);
  return { ...row, observed_minutes: cap(row.observed_minutes), usable_minutes: cap(row.usable_minutes) };
}

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

/**
 * The 24 bars of a day — RM-124 — summed over whatever devices the rows carry. The building is a
 * SUM of its branch meters here (`shared/circuits.mjs`), so the Overview passes the building
 * meters and the Circuits tab passes one; either way the hour's kWh is what phase42 credited, and
 * the bars sum to the same figure the stored day reports.
 *
 * Always 24 points, 0 to 23: a missing hour is a gap the chart must draw, not a renumbered axis.
 * An hour is `observed` when any device recorded a minute in it; its kWh is null when no device
 * carried a counter — those are different facts, as everywhere else on this page. Average power
 * adds across devices (each is over the same hour); the highest reading does not (peaks do not
 * coincide), so it is kept only when there is one device to read it from.
 */
export function toHourEnergyPoints(rows: readonly HourEnergyRow[]): HourlyEnergyPoint[] {
  const byHour = new Map<number, HourEnergyRow[]>();
  for (const r of rows) (byHour.get(r.local_hour) ?? byHour.set(r.local_hour, []).get(r.local_hour)!).push(r);
  return Array.from({ length: 24 }, (_, hour) => {
    const rs = byHour.get(hour) ?? [];
    const credited = rs.filter((r) => r.energy_kwh !== null);
    const withAvg = rs.filter((r) => r.avg_power_w !== null);
    return {
      hour,
      kwh: credited.length ? credited.reduce((a, r) => a + (r.energy_kwh ?? 0), 0) : null,
      observed: rs.some((r) => r.online_minutes > 0),
      clipped: rs.some((r) => r.clipped),
      avgW: withAvg.length ? withAvg.reduce((a, r) => a + (r.avg_power_w ?? 0), 0) : null,
      maxW: rs.length === 1 ? rs[0].max_power_w : null,
      minutes: rs.reduce((a, r) => Math.max(a, r.online_minutes), 0),
    };
  });
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

/** Optional cancellation — RM-081. A caller that gives up on a slow query aborts the request
 *  itself, so its answer does not keep crossing the Pi's uplink for nobody. */
export interface SeriesRequest {
  signal?: AbortSignal;
}

async function call<T>(fn: string, args: Record<string, unknown>, cap: number, signal?: AbortSignal): Promise<T[]> {
  let request = client().rpc(fn, args);
  if (signal) request = request.abortSignal(signal);
  const { data, error, status } = await request;
  if (error) throw new ReportQueryError(`${fn} failed`, error, status);
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

export async function getDailySeries(period: ReportPeriod, start: string, { signal }: SeriesRequest = {}): Promise<DailyRow[]> {
  // 31 days at most; 40 leaves room for a period type longer than a month without tripping.
  return call<DailyRow>('report_daily_series', window(period, start), 40, signal);
}

export async function getHourProfile(period: ReportPeriod, start: string, { signal }: SeriesRequest = {}): Promise<HourRow[]> {
  return call<HourRow>('report_hour_profile', window(period, start), 25, signal);
}

export async function getHourMatrix(period: ReportPeriod, start: string, { signal }: SeriesRequest = {}): Promise<MatrixRow[]> {
  return call<MatrixRow>('report_hour_matrix', window(period, start), MAX_MATRIX_CELLS + 1, signal);
}

/**
 * phase46's per-device hourly credits for the devices named — RM-124. 24 rows per device per day
 * of the window; the function raises above 900 rather than truncate, and this asks for one more
 * than that so a cut answer is loud here too.
 */
export async function getHourEnergy(period: ReportPeriod, start: string, deviceIds: readonly string[], { signal }: SeriesRequest = {}): Promise<HourEnergyRow[]> {
  if (deviceIds.length === 0) return [];
  return call<HourEnergyRow>('report_hour_energy', { ...window(period, start), p_device_ids: [...deviceIds] }, 901, signal);
}

export async function getDemandCurve(period: ReportPeriod, start: string, { signal }: SeriesRequest = {}): Promise<CurveRow[]> {
  return call<CurveRow>('report_demand_curve', window(period, start), 502, signal);
}

export async function getDemandSummary(period: ReportPeriod, start: string, { signal }: SeriesRequest = {}): Promise<DemandSummary | null> {
  const rows = await call<DemandSummary>('report_demand_summary', window(period, start), 2, signal);
  return rows[0] ? toDemandSummary(rows[0]) : null;
}
