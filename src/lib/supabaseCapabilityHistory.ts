/**
 * The questions phase28 was applied to make answerable.
 *
 * Its migration names four, and until now nothing asked any of them — the columns were filled
 * every minute and read by nobody, which is the same shape as the four capabilities that reached
 * the browser and were discarded before EX-167.
 *
 *   1. "Which branch tripped its power warning, and when?"   -> troubleEpisodes, `power_warn`
 *   2. "What is this meter's lifetime total?"                 -> energyBetween
 *   3. "Did this outlet report a fault before it went dark?"  -> troubleEpisodes, `fault`
 *   4. "Was the device on the cloud or the local network
 *       when it stopped answering?"                           -> lastNetState
 *
 * Same fetch pattern as `supabaseAnomalies.ts` and `supabaseHistory.ts`: explicit column list, a
 * prefixed `Error` when Supabase is not configured, and a truncation guard — PostgREST silently
 * caps a response and says nothing, which this project has been bitten by twice.
 *
 * The folding and the arithmetic live in `capabilityEpisodes.ts` and below, away from the I/O,
 * because those are the parts with decisions in them.
 */

import { supabase } from '@/config/supabase';
import { assertNotTruncated } from './supabaseHistory';
import { foldEpisodes, type CapabilityEpisode, type EpisodeSample } from './capabilityEpisodes';

/** How far back trouble is worth reporting. A week covers a weekend plus a public holiday —
 * the same reasoning as `fleetAlarm`'s known-online window. */
export const TROUBLE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/** Enough rows for a week of continuous trouble on the whole fleet, and a cap that says so if
 * it is ever hit rather than quietly returning a prefix. */
const MAX_ROWS = 5000;

/**
 * `net_state` values that mean something is wrong.
 *
 * `local_net` is NOT one of them, and getting that backwards would be the whole feature reporting
 * its own preferred path as a fault: `shared/sites/<id>/site.mjs` sets `dispatch: 'local-first'`,
 * so the LAN is where this system wants its devices. `cloud_net` is normal for a device that also
 * talks to the vendor. Only `no_net` is trouble.
 */
export const DEGRADED_NET_STATES = ['no_net'] as const;

function required() {
  if (!supabase) {
    throw new Error('Supabase is not configured (VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY unset)');
  }
  return supabase;
}

/**
 * Every stretch in which a device reported trouble, across the fleet.
 *
 * Three queries rather than one, because the three live in different columns and PostgREST has no
 * OR across them worth writing. Each asks only for the ABNORMAL rows — `fault <> 0`,
 * `power_type = warn`, `net_state = no_net` — so a healthy fleet returns three empty lists
 * rather than a week of identical rows. On this fleet today that is exactly what happens, and
 * "nothing since Tuesday" is the answer, not a blank.
 */
export async function fetchTroubleEpisodes(sinceMs = TROUBLE_LOOKBACK_MS): Promise<CapabilityEpisode[]> {
  const db = required();
  const since = new Date(Date.now() - sinceMs).toISOString();

  // Written out three times rather than through a shared builder. The wrapper that would remove
  // the repetition has to be generic over PostgREST's filter types, and the version that
  // typechecked was harder to read than this is — three queries that each say plainly which
  // column they ask for and what counts as abnormal in it.
  const collect = (
    column: 'fault' | 'power_type' | 'net_state',
    data: unknown[] | null,
    error: { message: string } | null,
  ): EpisodeSample[] => {
    if (error) throw new Error(`Supabase capability history fetch failed for ${column}: ${error.message}`);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    assertNotTruncated(rows, MAX_ROWS, `readings.${column}`);
    return rows.map((r) => ({
      device_id: String(r.device_id), ts: String(r.ts), value: r[column] as string | number,
    }));
  };

  const [faultRes, warnRes, netRes] = await Promise.all([
    db.from('readings').select('device_id,ts,fault')
      .gte('ts', since).neq('fault', 0).order('ts', { ascending: true }).limit(MAX_ROWS),
    db.from('readings').select('device_id,ts,power_type')
      .gte('ts', since).eq('power_type', 'warn').order('ts', { ascending: true }).limit(MAX_ROWS),
    db.from('readings').select('device_id,ts,net_state')
      .gte('ts', since).in('net_state', [...DEGRADED_NET_STATES]).order('ts', { ascending: true }).limit(MAX_ROWS),
  ]);

  const faults = collect('fault', faultRes.data, faultRes.error);
  const warns = collect('power_type', warnRes.data, warnRes.error);
  const offline = collect('net_state', netRes.data, netRes.error);

  return [
    ...foldEpisodes(faults, 'fault'),
    ...foldEpisodes(warns, 'power_warn'),
    ...foldEpisodes(offline, 'net_degraded'),
  ].sort((a, b) => Date.parse(b.from) - Date.parse(a.from));
}

/**
 * What a device last said about its own network path while it was still answering.
 *
 * Question 4, and the reason it is worth a query of its own: it is asked about a device that is
 * dark NOW, so the current reading says nothing. `online=true` is the filter that matters —
 * the last row before it went quiet, not the last row.
 */
export async function fetchLastNetState(deviceId: string): Promise<{ net_state: string; ts: string } | null> {
  const db = required();
  const { data, error } = await db
    .from('readings')
    .select('net_state,ts')
    .eq('device_id', deviceId)
    .eq('online', true)
    .not('net_state', 'is', null)
    .order('ts', { ascending: false })
    .limit(1);
  if (error) throw new Error(`Supabase net_state fetch failed for ${deviceId}: ${error.message}`);
  const row = (data ?? [])[0] as { net_state: string; ts: string } | undefined;
  return row ? { net_state: row.net_state, ts: row.ts } : null;
}

/** What `energyBetween` concluded, and why it concluded nothing when it did. */
export interface EnergySpan {
  kwh: number | null;
  from: string | null;
  to: string | null;
  reason?: string;
}

/**
 * How much a meter consumed between its first and last lifetime reading in a window.
 *
 * `total_energy_kwh` is the device's OWN lifetime accumulator, stored raw — phase28 says why:
 * "monotonic except across a device reset, which is why it is stored raw rather than differenced
 * here". Differencing is therefore this function's job, and so is refusing to when the assumption
 * fails: a counter that went DOWN was reset, and the difference across a reset is not a quantity
 * of electricity. Returning a negative number, or an absolute value, would be inventing one.
 *
 * Pure, and exported separately from the fetch so the reset case can be tested without a
 * database — it has never happened on this fleet and cannot be waited for.
 */
export function energyBetween(rows: Array<{ ts: string; total_energy_kwh: number | null }>): EnergySpan {
  const usable = rows
    .filter((r) => typeof r.total_energy_kwh === 'number' && Number.isFinite(r.total_energy_kwh))
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

  if (usable.length < 2) {
    return { kwh: null, from: usable[0]?.ts ?? null, to: usable[0]?.ts ?? null, reason: 'not enough readings to difference' };
  }
  const first = usable[0];
  const last = usable[usable.length - 1];
  const delta = (last.total_energy_kwh as number) - (first.total_energy_kwh as number);
  if (delta < 0) {
    return { kwh: null, from: first.ts, to: last.ts, reason: 'the meter’s lifetime counter was reset in this window' };
  }
  return { kwh: delta, from: first.ts, to: last.ts };
}

/** One meter's lifetime readings across a window, differenced. Question 2. */
export async function fetchEnergyBetween(deviceId: string, sinceMs: number): Promise<EnergySpan> {
  const db = required();
  const since = new Date(Date.now() - sinceMs).toISOString();
  const { data, error } = await db
    .from('readings')
    .select('ts,total_energy_kwh')
    .eq('device_id', deviceId)
    .not('total_energy_kwh', 'is', null)
    .gte('ts', since)
    .order('ts', { ascending: true })
    .limit(MAX_ROWS);
  if (error) throw new Error(`Supabase lifetime energy fetch failed for ${deviceId}: ${error.message}`);
  const rows = (data ?? []) as Array<{ ts: string; total_energy_kwh: number | null }>;
  assertNotTruncated(rows, MAX_ROWS, `readings.total_energy_kwh(${deviceId})`);
  return energyBetween(rows);
}
