/**
 * `socket_config` — per-socket operator metadata, phase34 / RM-060.
 *
 * Mirrors `supabaseDeviceConfig.ts` deliberately: same shape, same row-count check, same
 * attribution rule. The one difference is the conflict target, which is the composite primary
 * key `(device_id, socket)`.
 *
 * ON THAT TARGET, because this repo has a scar here. supabase-js's `upsert` generates
 * `ON CONFLICT (device_id, socket) DO UPDATE`, and Postgres matches that only against an
 * UNCONDITIONAL constraint — `phase6_schedules_unique_fix.sql` is the file this project wrote
 * after learning that from a partial index, live. A composite PRIMARY KEY is unconditional by
 * construction, which is why phase34 uses one.
 */

import { supabase } from '@/config/supabase';
import { coerceLoadShedGroup, type LoadShedGroup } from './deviceConfig';
import type { SocketIndex } from './types';

export interface SocketConfig {
  deviceId: string;
  socket: SocketIndex;
  loadShedGroup: LoadShedGroup | null;
  /** What is plugged in. "Socket 2" and "Kettle" are very different things to tier. */
  label: string | null;
}

interface SocketConfigRow {
  device_id: string;
  socket: number;
  load_shed_group: string | null;
  label: string | null;
}

/** device id -> socket -> config. Two levels because both are natural lookup keys. */
export type SocketConfigMap = Record<string, Record<number, SocketConfig>>;

const SELECT = 'device_id,socket,load_shed_group,label';

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured (VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY unset)');
  return supabase;
}

export function socketConfigFromRow(row: SocketConfigRow): SocketConfig {
  return {
    deviceId: row.device_id,
    socket: (row.socket === 2 ? 2 : 1) as SocketIndex,
    loadShedGroup: coerceLoadShedGroup(row.load_shed_group),
    label: row.label ?? null,
  };
}

export function socketConfigsToMap(rows: SocketConfigRow[]): SocketConfigMap {
  const out: SocketConfigMap = {};
  for (const row of rows) {
    const cfg = socketConfigFromRow(row);
    (out[cfg.deviceId] ??= {})[cfg.socket] = cfg;
  }
  return out;
}

export function socketConfigToRow(cfg: SocketConfig, actorUserId: string | null) {
  return {
    device_id: cfg.deviceId,
    socket: cfg.socket,
    load_shed_group: cfg.loadShedGroup,
    label: cfg.label || null,
    updated_by: actorUserId,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Reads every socket row.
 *
 * A deployment that has not applied phase34 answers `42P01` (undefined table). That is not an
 * error worth surfacing to an operator: `resolveShedTier` falls back to the device-level tier
 * for any socket with no row, which is exactly the pre-RM-060 behaviour. Returning empty keeps
 * the panel working and the tiers correct until the migration lands.
 */
export async function fetchSocketConfigs(): Promise<SocketConfigMap> {
  const client = requireSupabase();
  const { data, error } = await client.from('socket_config').select(SELECT);
  if (error) {
    if (error.code === '42P01') return {};
    throw new Error(`Supabase socket_config fetch failed: ${error.message}`);
  }
  return socketConfigsToMap((data ?? []) as SocketConfigRow[]);
}

export async function writeSocketConfig(cfg: SocketConfig, actorUserId: string | null): Promise<void> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('socket_config')
    .upsert(socketConfigToRow(cfg, actorUserId), { onConflict: 'device_id,socket' })
    .select('device_id');
  if (error) {
    if (error.code === '23503') {
      throw new Error(`Supabase socket_config write failed: device ${cfg.deviceId} hasn't synced into the devices table yet — wait for the next ingest cycle and try again.`);
    }
    if (error.code === '42P01') {
      throw new Error('Supabase socket_config write failed: the table does not exist. Apply supabase/phase34_socket_config.sql.');
    }
    throw new Error(`Supabase socket_config write failed: ${error.message}`);
  }
  // PostgREST reports an RLS policy matching zero rows as a plain 200 with an EMPTY array, so
  // `{error}` alone stays null even when nothing was written.
  if ((data?.length ?? 0) !== 1) {
    throw new Error(`Supabase socket_config write for ${cfg.deviceId} socket ${cfg.socket} affected 0 rows — check that you're signed in with a real Supabase session, not a break-glass one.`);
  }
}
