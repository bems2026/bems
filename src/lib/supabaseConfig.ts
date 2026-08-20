/**
 * Schedules/DSM-thresholds config — architecture plan Phase 6. Reads and writes Supabase's
 * `schedules` and `dsm_thresholds` tables directly from the browser (RLS-gated to
 * `authenticated`, same pattern as `supabaseHistory.ts`'s Phase 4 reads — no general CRUD
 * backend needed for this).
 *
 * Deliberately keeps the SAME flat `ContextMap` shape (`global.schedule.<id>.<field>`,
 * `global.dsm.<field>`, `global.trigger.care_acu_on`) that `AutomationPage.tsx`,
 * `ScheduleRow.tsx`, `DsmThresholdsCard.tsx`, `automationMath.ts`, and `dsm.ts` were already
 * built and tested against (Node-RED's own former global-context key convention). Only
 * `contextStore.ts`'s `load`/`save` internals call into this file — every one of those
 * components is untouched by this migration, translation happens here alone.
 */

import { supabase } from '@/config/supabase';
import { scheduleKey } from '@/components/automation/automationMath';
import type { ContextMap } from './types';

const MAX_PHASE_KEY = 'global.dsm.max_phase_a';
const MAX_TOTAL_KEY = 'global.dsm.max_total_kw';
const AUTO_SHED_KEY = 'global.dsm.auto_shed';
const TRIGGER_KEY = 'global.trigger.care_acu_on';

const SCHEDULE_KEY_RE = /^global\.schedule\.([^.]+)\.(on|off|days|armed)$/;

interface ScheduleRow {
  device_id: string;
  rule: { on?: string; off?: string; days?: string } | null;
  enabled: boolean;
}

interface DsmThresholdsRow {
  max_phase_current: number | null;
  max_total_kw: number | null;
  auto_shed: boolean;
  care_acu_trigger_c: number | null;
}

function num(v: string | undefined): number | null {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Throws if Supabase isn't configured — same contract as `supabaseHistory.ts`'s
 * `getLongHistory`; callers (`contextStore.ts`) must catch and surface this as the
 * store's existing `'error'` status rather than let it escape uncaught. */
function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured (VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY unset)');
  return supabase;
}

/** Pure — exported separately for unit testing without a live Supabase project, same
 * pattern as `supabaseHistory.ts`'s `mapReadingsRows`. */
export function scheduleRowsToContext(rows: ScheduleRow[]): ContextMap {
  const ctx: ContextMap = {};
  for (const row of rows) {
    if (row.rule?.on) ctx[scheduleKey(row.device_id, 'on')] = row.rule.on;
    if (row.rule?.off) ctx[scheduleKey(row.device_id, 'off')] = row.rule.off;
    if (row.rule?.days) ctx[scheduleKey(row.device_id, 'days')] = row.rule.days;
    ctx[scheduleKey(row.device_id, 'armed')] = String(row.enabled);
  }
  return ctx;
}

export function dsmRowToContext(row: DsmThresholdsRow | null): ContextMap {
  if (!row) return {};
  const ctx: ContextMap = {};
  if (row.max_phase_current !== null) ctx[MAX_PHASE_KEY] = String(row.max_phase_current);
  if (row.max_total_kw !== null) ctx[MAX_TOTAL_KEY] = String(row.max_total_kw);
  ctx[AUTO_SHED_KEY] = String(row.auto_shed);
  if (row.care_acu_trigger_c !== null) ctx[TRIGGER_KEY] = String(row.care_acu_trigger_c);
  return ctx;
}

/** Everything `contextStore.load()` needs, in the one shape every existing Automation
 * component already reads (`saved: ContextMap`). */
/**
 * The rows a schedules write sends. Pure and exported so attribution is unit-testable without
 * a Supabase client, the same way `supabaseDeviceConfig.deviceConfigToRow` is.
 *
 * `updated_by` is load-bearing rather than bookkeeping: `server/scheduler.mjs` attributes the
 * command it fires to whoever saved the schedule, and skips any row without one, because
 * `commands.requested_by` is NOT NULL and a fabricated user in the audit table is worse than
 * a gap. A write that omits this produces schedules that silently never fire.
 *
 * `updated_at` is set explicitly because the column's `default now()` only applies on INSERT,
 * and these are upserts over rows that usually already exist.
 */
export function scheduleRowsFor(deviceIds: Set<string>, merged: ContextMap, actorUserId: string | null) {
  const now = new Date().toISOString();
  return Array.from(deviceIds).map((deviceId) => ({
    device_id: deviceId,
    socket: null,
    rule: {
      on: merged[scheduleKey(deviceId, 'on')] ?? null,
      off: merged[scheduleKey(deviceId, 'off')] ?? null,
      days: merged[scheduleKey(deviceId, 'days')] ?? null,
    },
    enabled: merged[scheduleKey(deviceId, 'armed')] === 'true',
    updated_by: actorUserId,
    updated_at: now,
  }));
}

/** The DSM singleton's update payload. Same attribution reasoning as `scheduleRowsFor`. */
export function dsmRowFrom(merged: ContextMap, actorUserId: string | null) {
  return {
    max_phase_current: num(merged[MAX_PHASE_KEY]),
    max_total_kw: num(merged[MAX_TOTAL_KEY]),
    auto_shed: merged[AUTO_SHED_KEY] === 'true',
    care_acu_trigger_c: num(merged[TRIGGER_KEY]),
    updated_by: actorUserId,
    updated_at: new Date().toISOString(),
  };
}

export async function fetchScheduleContext(): Promise<ContextMap> {
  const client = requireSupabase();
  const [schedules, thresholds] = await Promise.all([
    client.from('schedules').select('device_id,rule,enabled').is('socket', null),
    client.from('dsm_thresholds').select('max_phase_current,max_total_kw,auto_shed,care_acu_trigger_c').eq('id', 1).maybeSingle(),
  ]);
  if (schedules.error) throw new Error(`Supabase schedules fetch failed: ${schedules.error.message}`);
  if (thresholds.error) throw new Error(`Supabase dsm_thresholds fetch failed: ${thresholds.error.message}`);
  return { ...scheduleRowsToContext(schedules.data ?? []), ...dsmRowToContext(thresholds.data) };
}

/**
 * Groups `pending`'s changed keys by which device (or the DSM singleton) they belong to,
 * then writes each as one whole-row upsert/update built from `merged` (`{...saved,
 * ...pending}`) — `rule` is a single jsonb column per device, so a partial on/off/days
 * write still needs the other, unchanged fields alongside it to avoid clobbering them.
 */
export async function writeScheduleContext(pending: ContextMap, merged: ContextMap): Promise<void> {
  const client = requireSupabase();
  // Same source of truth for "who is acting" that deviceConfigStore already uses.
  const actorUserId = (await client.auth.getSession()).data.session?.user.id ?? null;

  const deviceIds = new Set<string>();
  let dsmChanged = false;
  for (const key of Object.keys(pending)) {
    const m = SCHEDULE_KEY_RE.exec(key);
    if (m) {
      deviceIds.add(m[1]);
      continue;
    }
    if (key === MAX_PHASE_KEY || key === MAX_TOTAL_KEY || key === AUTO_SHED_KEY || key === TRIGGER_KEY) dsmChanged = true;
  }

  if (deviceIds.size > 0) {
    const rows = scheduleRowsFor(deviceIds, merged, actorUserId);
    // Matches supabase/phase6_schedules_unique_fix.sql's plain UNIQUE(device_id) — a
    // partial index (WHERE socket IS NULL, this app's first attempt) can't be targeted by
    // upsert()'s generated `ON CONFLICT (device_id) DO UPDATE`; Postgres only matches that
    // against an unconditional unique constraint. Confirmed the hard way, live.
    //
    // .select() and a row-count check are load-bearing, not decoration: PostgREST reports
    // an RLS policy silently matching zero rows as a plain 200 with an EMPTY array, not an
    // error — `{error}` alone stays null even when nothing was actually written. Confirmed
    // live: a save reported "Wrote 8 keys" while both tables stayed completely untouched.
    const { data, error } = await client.from('schedules').upsert(rows, { onConflict: 'device_id' }).select('device_id');
    if (error) throw new Error(`Supabase schedules write failed: ${error.message}`);
    if ((data?.length ?? 0) !== rows.length) {
      throw new Error(`Supabase schedules write affected ${data?.length ?? 0} of ${rows.length} row(s) — check that you're signed in with a real Supabase session, not a break-glass one.`);
    }
  }

  if (dsmChanged) {
    const { data, error } = await client
      .from('dsm_thresholds')
      .update(dsmRowFrom(merged, actorUserId))
      .eq('id', 1)
      .select('id');
    if (error) throw new Error(`Supabase dsm_thresholds write failed: ${error.message}`);
    if ((data?.length ?? 0) !== 1) {
      throw new Error('Supabase dsm_thresholds write matched no row — check that you\'re signed in with a real Supabase session, not a break-glass one.');
    }
  }
}
