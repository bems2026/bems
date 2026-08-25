import { supabase } from '@/config/supabase';


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
 * Whether a device is flapping, and how badly. The only thing rendered from this row now — the
 * uptime percentage and its coverage qualifier were removed once it became clear the percentage
 * could not be read correctly without one, and a number needing a caveat is the wrong number to
 * show. A transition count needs no denominator: at worst it undercounts, which is honest.
 */
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

/**
 * Devices that WERE reachable in the window and are not now, separated from those that have
 * never been reachable in it.
 *
 * WHY THE SEPARATION IS THE WHOLE POINT: on 2026-08-25 a Node-RED restart recovered five
 * devices that a written diagnosis had called a hardware fault — `l6` was recorded as
 * `EHOSTUNREACH` at every protocol version with a roadmap entry saying it needed eyes on the
 * fixture, and it reconnected in two seconds. A tuya node that has given up stays given up and
 * presents exactly like an unplugged device, so the remedy is cheap, remote, and was invisible.
 *
 * But two devices on this site are offline permanently by design (the IR blaster and the
 * outside-temp sensor are not in the vendor cloud project and are deliberately quiesced), and
 * counting them would hold this signal on forever — which is how a warning becomes furniture.
 * `online_samples` draws the line with evidence rather than a hardcoded exclusion list: a
 * device that was up at some point in the window CAN be up, so it being down now is a change.
 * One that has never been up in 24 hours is not news, and no restart will alter that.
 */
export interface FleetStuckResult {
  /** Offline now, but seen online within the window — the recoverable-looking case. */
  stuck: string[];
  /** Offline now and never seen online in the window. Reported, but deliberately not counted. */
  chronic: string[];
}

/**
 * How many simultaneous drops make it a fleet event rather than one device being flaky.
 *
 * One device dropping is RM-013 doing what RM-013 does, and firing on it would mean firing
 * most days. Three at once is something that happened — an access point re-selecting its
 * channel, or the bridge's nodes giving up together, which is the case a restart fixes.
 */
export const FLEET_STUCK_AT = 3;

export function fleetStuck(rows: Record<string, ConnectivityRow>): FleetStuckResult {
  const stuck: string[] = [];
  const chronic: string[] = [];
  for (const row of Object.values(rows)) {
    if (row.currently_online) continue;
    (row.online_samples > 0 ? stuck : chronic).push(row.device_id);
  }
  return { stuck: stuck.sort(), chronic: chronic.sort() };
}

export function isFleetStuck(result: FleetStuckResult): boolean {
  return result.stuck.length >= FLEET_STUCK_AT;
}
