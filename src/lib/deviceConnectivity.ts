import { supabase } from '@/config/supabase';
import { coverageOf, type Coverage } from './supabaseReports';

/**
 * Per-device uptime and flap count, read from `readings.online` through the
 * `device_connectivity` RPC (`supabase/phase15_device_connectivity.sql`).
 *
 * WHY THIS EXISTS:
 * The dashboard could say whether a device is online *now*, and nothing else. On 2026-08-24
 * the field devices began disassociating from the access point and rejoining — 17 announcing
 * hosts fell to 13 within half an hour — and diagnosing that took a packet capture on the Pi.
 * The data to see it from the dashboard had been written every 60 seconds for weeks; nothing
 * read it that way.
 *
 * This module is deliberately pure apart from `fetchDeviceConnectivity`: the thresholds below
 * are judgements about what counts as unstable, and judgements should be testable without a
 * network.
 */

export interface ConnectivityRow {
  device_id: string;
  samples: number;
  online_samples: number;
  transitions: number;
  last_change: string | null;
  currently_online: boolean;
  /**
   * How many samples the window *should* hold — the window in minutes, since ingestion writes
   * every 60s. Optional because a row from the first version of the RPC does not carry it, and
   * defaulting it would invent the denominator this field exists to make explicit.
   */
  expected_samples?: number;
}

export type FlapSeverity = 'unknown' | 'steady' | 'unstable' | 'severe';

/**
 * A single transition is not flapping. A device that dropped once and came back has recovered,
 * and calling that unstable would flag every ordinary restart — which is how a warning becomes
 * something people stop reading.
 */
const UNSTABLE_AT = 2;
/** Roughly one state change every 45 minutes across a 24h window. */
const SEVERE_AT = 32;

/** Postgres `bigint` arrives as a JSON string through PostgREST; supabase-js does not coerce it. */
const num = (v: number | string): number => (typeof v === 'number' ? v : Number(v));

export function connectivityRowsToMap(rows: ConnectivityRow[]): Record<string, ConnectivityRow> {
  const map: Record<string, ConnectivityRow> = {};
  for (const r of rows) {
    map[r.device_id] = {
      ...r,
      samples: num(r.samples),
      online_samples: num(r.online_samples),
      transitions: num(r.transitions),
    };
  }
  return map;
}

/**
 * Share of the window a device was online, or `null` when the window holds no samples.
 *
 * `null`, not 0. A device with no rows has *unknown* uptime; rendering 0% would assert it was
 * down for the whole window, which is a far stronger claim than "nothing was recorded" — the
 * same distinction `format.ts` draws between a missing value and a real zero.
 */
export function uptimeRatio(row: ConnectivityRow): number | null {
  const samples = num(row.samples);
  if (samples === 0) return null;
  return num(row.online_samples) / samples;
}

/**
 * How much of the window actually has data, as distinct from how much of it was online.
 *
 * These come apart for outlets specifically. `buildLatest.mjs` stamps a device-reported
 * timestamp when one exists, `readings` is keyed `(device_id, ts)`, and ingestion upserts — so
 * an outlet whose clock stalls overwrites its own row every minute instead of adding one, and
 * its `samples` silently undercounts the window. Rendering its uptime beside a meter's, both as
 * bare percentages, presents two different measurements as one.
 *
 * Same discipline `monthly_reports` already applies: a figure never travels without its
 * coverage, so a barely-observed window cannot quote a bare total. Reuses `coverageOf` rather
 * than restating its bands.
 */
export function connectivityCoverage(row: ConnectivityRow): Coverage | null {
  if (row.expected_samples === undefined) return null;
  return coverageOf(num(row.samples), num(row.expected_samples));
}

export function flapSeverity(row: ConnectivityRow): FlapSeverity {
  if (num(row.samples) === 0) return 'unknown';
  const t = num(row.transitions);
  if (t >= SEVERE_AT) return 'severe';
  if (t >= UNSTABLE_AT) return 'unstable';
  return 'steady';
}

/** Throws if Supabase is not configured — same contract as the other Supabase-backed modules. */
export async function fetchDeviceConnectivity(windowHours = 24): Promise<Record<string, ConnectivityRow>> {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase.rpc('device_connectivity', { p_window_hours: windowHours });
  if (error) throw new Error(`Connectivity fetch failed: ${error.message}`);
  return connectivityRowsToMap((data ?? []) as ConnectivityRow[]);
}
