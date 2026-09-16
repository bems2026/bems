import { supabase } from '@/config/supabase';
import { SITE } from '@shared/siteConfig.mjs';
import { assertNotTruncated } from './supabaseHistory';
import type { ReportPeriod } from './supabaseReports';

/**
 * Per-circuit series for a settled week or month — RM-094.
 *
 * Until now a report could only say what each circuit used over the whole period: `period_reports`
 * holds one row per device, and every chart on the page was the building's. The operator asked for the
 * branch circuits' own weekly and monthly graphs, as Analytics draws them for "now". Two reads make that
 * possible for any stored period, and both stay inside the rules the rest of the page keeps:
 *
 *   DAILY ENERGY, from phase42's `report_device_daily_energy` — the same bounded rule the stored reports
 *   are generated with (RM-091), so a circuit's bars sum to its figure in the table and a counter jump
 *   is as absent from the chart as it is from the total. The function does not exist until the operator
 *   applies phase42; that is `{ available: false }`, which the page explains, and it is never retried.
 *
 *   HOURLY POWER, from `readings_archive` — the function Analytics' long ranges already read, hourly
 *   buckets over the hourly rollup and the raw minutes, one call per branch meter. Every hour of the
 *   window gets a slot, and an hour nothing was recorded in is empty, never 0 W.
 *
 * The window comes from `report_window`, never from date arithmetic in the browser, so the chart and
 * the stored report cannot disagree about where a week begins.
 */

const TZ = SITE.timezone;
const HOUR_MS = 3_600_000;
/** PostgREST's row cap. Every read here is bounded well below it, so reaching it means a cut answer. */
const API_ROW_CAP = 1000;

export interface DeviceDayRow {
  device_id: string;
  local_day: string;
  energy_kwh: number | null;
  counter_kwh: number | null;
  removed_kwh: number | null;
  clipped_hours: number;
  peak_power_w: number | null;
  avg_power_w: number | null;
  online_minutes: number;
  expected_minutes: number;
  resolution: string | null;
}

export type DeviceDaily = { available: true; rows: DeviceDayRow[] } | { available: false };

export interface HourSlot {
  startMs: number;
  /** The hour's average power while online; `null` when nothing was recorded. */
  avgW: number | null;
  maxW: number | null;
  online: number;
  samples: number;
}

export interface CircuitTrend {
  startMs: number;
  endMs: number;
  series: { meterId: string; slots: HourSlot[] }[];
}

interface ArchiveRow {
  ts: string;
  power_w: number | null;
  power_w_max: number | null;
  voltage: number | null;
  current: number | null;
  energy_kwh_max: number | null;
  sample_count: number | null;
  online_count: number | null;
}

interface WindowRow {
  local_start: string;
  win_start: string;
  win_end: string;
  expected_minutes: number;
}

interface Request {
  signal?: AbortSignal;
}

/**
 * Whether a failure means the function is not on this database. PostgREST answers PGRST202 for a
 * function missing from its schema cache; Postgres itself says 42883. A refusal (42501) or a timeout
 * (57014) is a real failure and must not be explained away as "not installed".
 */
export function isMissingFunction(error: { code?: string } | null | undefined): boolean {
  return error?.code === 'PGRST202' || error?.code === '42883';
}

function client() {
  if (!supabase) throw new Error('Supabase is not configured — the report series are stored there.');
  return supabase;
}

async function rpc<T>(fn: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<{ data: T[] | null; error: { code?: string; message: string } | null }> {
  let request = client().rpc(fn, args);
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  return { data: (data ?? null) as T[] | null, error };
}

/** Each device's bounded energy per local day of the period. */
export async function getDeviceDailyEnergy(period: ReportPeriod, start: string, deviceIds: readonly string[], { signal }: Request = {}): Promise<DeviceDaily> {
  if (deviceIds.length === 0) return { available: true, rows: [] };
  const { data, error } = await rpc<DeviceDayRow>(
    'report_device_daily_energy',
    { p_period: period, p_start: start, p_tz: TZ, p_device_ids: [...deviceIds] },
    signal
  );
  if (isMissingFunction(error)) return { available: false };
  if (error) throw new Error(`report_device_daily_energy failed: ${error.message}`);
  const rows = assertNotTruncated(data ?? [], API_ROW_CAP, `report_device_daily_energy(${period}, ${start})`);
  return { available: true, rows };
}

/**
 * Every hour of `[startIso, endIso)`, filled from the archive's rows. Pure. A row outside the window is
 * dropped rather than folded into an edge slot — the mistake `timeseries.alignToGrid` documents.
 */
export function densifyHours(rows: readonly ArchiveRow[], startIso: string, endIso: string): HourSlot[] {
  const startMs = Date.parse(startIso);
  const count = Math.max(0, Math.round((Date.parse(endIso) - startMs) / HOUR_MS));
  const slots: HourSlot[] = Array.from({ length: count }, (_, i) => ({ startMs: startMs + i * HOUR_MS, avgW: null, maxW: null, online: 0, samples: 0 }));
  for (const row of rows) {
    const i = Math.round((Date.parse(row.ts) - startMs) / HOUR_MS);
    if (i < 0 || i >= count) continue;
    const online = row.online_count ?? 0;
    slots[i] = {
      startMs: slots[i].startMs,
      // Nothing online means nothing measured, whatever a bucket's average happens to hold.
      avgW: online > 0 ? row.power_w : null,
      maxW: online > 0 ? row.power_w_max : null,
      online,
      samples: row.sample_count ?? 0,
    };
  }
  return slots;
}

/** Each branch meter's power, hour by hour, across the period. */
export async function getCircuitTrend(period: ReportPeriod, start: string, meterIds: readonly string[], { signal }: Request = {}): Promise<CircuitTrend> {
  const win = await rpc<WindowRow>('report_window', { p_period: period, p_start: start, p_tz: TZ }, signal);
  if (win.error) throw new Error(`report_window failed: ${win.error.message}`);
  const w = win.data?.[0];
  if (!w) throw new Error(`report_window returned no window for ${period} ${start}`);

  const series = await Promise.all(
    meterIds.map(async (meterId) => {
      const { data, error } = await rpc<ArchiveRow>(
        'readings_archive',
        { p_device_id: meterId, p_since: w.win_start, p_until: w.win_end, p_bucket_seconds: 3600 },
        signal
      );
      if (error) throw new Error(`readings_archive failed for ${meterId}: ${error.message}`);
      // 744 hours at most; the function itself refuses more than 900.
      const rows = assertNotTruncated(data ?? [], 900, `readings_archive(${meterId})`);
      return { meterId, slots: densifyHours(rows, w.win_start, w.win_end) };
    })
  );
  return { startMs: Date.parse(w.win_start), endMs: Date.parse(w.win_end), series };
}
