/**
 * `device_config` reads and writes — architecture plan Phase 7. Reads and writes Supabase's
 * `device_config` table directly from the browser (RLS-gated to `authenticated`, same pattern
 * as `supabaseConfig.ts`'s schedules/dsm_thresholds and `supabaseHistory.ts`'s Phase 4 reads —
 * no general CRUD backend needed for this).
 *
 * Row <-> model translation lives here alone, pure and exported for unit testing without a
 * live Supabase project — same split `supabaseConfig.ts` draws between its mappers and its
 * network calls.
 */

import { supabase } from '@/config/supabase';
import { parseFixtures } from './lightingGrid';
import { coerceFunctions } from './deviceFunctions';
import { coerceCategory, coerceLoadShedGroup, normalizeDeviceConfig, type DeviceConfig } from './deviceConfig';
import { coercePlanCoord } from './planLayout';

interface DeviceConfigRow {
  device_id: string;
  space_node_id: string | null;
  /** `numeric` columns from phase23. Typed as `unknown` because PostgREST's JSON encoding of
   * `numeric` is not something this codebase gets to assume — `count(*)` already arrived here
   * as a string once. (Measured 2026-08-28: these come back as JSON numbers. The tolerance
   * stays; the encoding is decided elsewhere.) `coercePlanCoord` accepts either and refuses
   * anything else, and a deployment that has not applied phase23 yet simply has neither key. */
  plan_x?: unknown;
  plan_fixtures?: unknown;
  plan_y?: unknown;
  functions: string[] | null;
  room: string | null;
  category: string | null;
  load_shed_group: string | null;
  display_name_override: string | null;
  notes: string | null;
}

/** What gets sent on a write — `updated_by` in, `device_id` as the PK the upsert targets. */
interface DeviceConfigWriteRow {
  device_id: string;
  space_node_id: string | null;
  plan_x: number | null;
  plan_fixtures: unknown;
  plan_y: number | null;
  functions: string[] | null;
  room: string | null;
  category: string | null;
  load_shed_group: string | null;
  display_name_override: string | null;
  notes: string | null;
  updated_by: string | null;
}

/** Throws if Supabase isn't configured — same contract as `supabaseConfig.ts`'s
 * `requireSupabase`; callers must catch and surface this as the store's existing `'error'`
 * status rather than let it escape uncaught. */
function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured (VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY unset)');
  return supabase;
}

/** Pure — exported separately for unit testing without a live Supabase project, same pattern
 * as `supabaseConfig.ts`'s `scheduleRowsToContext`. Unknown category/load_shed_group values
 * (e.g. a row written by a future version of this UI with an option this build doesn't know)
 * drop to null through the same coercers `deviceConfig.ts`'s normalize path uses, rather than
 * rendering a raw unrecognized string in a <select>. */
export function deviceConfigRowToModel(row: DeviceConfigRow): DeviceConfig {
  return {
    deviceId: row.device_id,
    spaceNodeId: row.space_node_id,
    planX: coercePlanCoord(row.plan_x),
    planFixtures: parseFixtures(row.plan_fixtures),
    planY: coercePlanCoord(row.plan_y),
    room: row.room,
    category: coerceCategory(row.category),
    loadShedGroup: coerceLoadShedGroup(row.load_shed_group),
    displayNameOverride: row.display_name_override,
    notes: row.notes,
    functions: coerceFunctions(row.functions),
  };
}

export function deviceConfigsToMap(rows: DeviceConfigRow[]): Record<string, DeviceConfig> {
  const map: Record<string, DeviceConfig> = {};
  for (const row of rows) {
    map[row.device_id] = deviceConfigRowToModel(row);
  }
  return map;
}

/** Builds the row a write sends: normalizes text/enum fields (trims, collapses '' to null,
 * drops unknown enum values) exactly as `deviceConfig.ts`'s `normalizeDeviceConfig` does, then
 * stamps the actor. `actorUserId` is nullable in the type because a caller with no real
 * Supabase session must still be able to construct a row to reason about — the store is what
 * refuses to call `writeDeviceConfig` without one, not this function. */
export function deviceConfigToRow(config: DeviceConfig, actorUserId: string | null): DeviceConfigWriteRow {
  const normalized = normalizeDeviceConfig(config);
  return {
    device_id: normalized.deviceId,
    functions: normalized.functions,
    space_node_id: normalized.spaceNodeId,
    // Carried on every write because this is a WHOLE-ROW upsert. A row builder that omitted the
    // position would null it on any unrelated edit — a notes change erasing a placement, with
    // no error and from a screen that never mentioned the plan.
    plan_x: normalized.planX,
    // Same whole-row reasoning as plan_x below: omitting this would erase a ceiling layout
    // on any unrelated edit, silently, from a screen that never mentioned lighting.
    plan_fixtures: normalized.planFixtures,
    plan_y: normalized.planY,
    room: normalized.room,
    category: normalized.category,
    load_shed_group: normalized.loadShedGroup,
    display_name_override: normalized.displayNameOverride,
    notes: normalized.notes,
    updated_by: actorUserId,
  };
}

/** Everything `deviceConfigStore.load()` needs, keyed by device id. */
export async function fetchDeviceConfigs(): Promise<Record<string, DeviceConfig>> {
  const client = requireSupabase();
  const { data, error } = await client.from('device_config').select('device_id,space_node_id,plan_x,plan_y,plan_fixtures,room,category,load_shed_group,display_name_override,notes,functions');
  if (error) throw new Error(`Supabase device_config fetch failed: ${error.message}`);
  return deviceConfigsToMap(data ?? []);
}

/**
 * One whole-row upsert for one device. `.select()` and a row-count check are load-bearing, not
 * decoration, same lesson `supabaseConfig.ts`'s `writeScheduleContext` already paid for:
 * PostgREST reports an RLS policy silently matching zero rows as a plain 200 with an EMPTY
 * array, not an error — `{error}` alone stays null even when nothing was actually written.
 *
 * A `23503` error is a foreign-key violation — `device_config.device_id` references
 * `devices(id)`, so this device hasn't been synced into `devices` by `server/ingest.mjs` yet.
 * Surfaced as its own message rather than a raw Postgres error string, because "wait for the
 * next device sync" is an actionable, specific answer this app can give.
 */
export async function writeDeviceConfig(config: DeviceConfig, actorUserId: string | null): Promise<void> {
  const client = requireSupabase();
  const row = deviceConfigToRow(config, actorUserId);
  const { data, error } = await client.from('device_config').upsert(row, { onConflict: 'device_id' }).select('device_id');
  if (error) {
    if (error.code === '23503') {
      throw new Error(`Supabase device_config write failed: device ${config.deviceId} hasn't synced into the devices table yet — wait for the next ingest cycle and try again.`);
    }
    throw new Error(`Supabase device_config write failed: ${error.message}`);
  }
  if ((data?.length ?? 0) !== 1) {
    throw new Error(`Supabase device_config write for ${config.deviceId} affected 0 rows — check that you're signed in with a real Supabase session, not a break-glass one.`);
  }
}
