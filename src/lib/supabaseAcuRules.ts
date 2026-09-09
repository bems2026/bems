/**
 * Closed-loop aircon rules and what the controller remembers about each — RM-062, phase36.
 *
 * WRITES GO THROUGH AN RPC, NOT AN UPSERT, and that is the same argument
 * `supabasePolicy.ts` already makes: `acu_rules` grants SELECT and DELETE to `authenticated`
 * and no insert or update policy at all, because Postgres RLS is row-level and its `WITH CHECK`
 * cannot see OLD — so a policy narrow enough to permit an in-policy target and refuse a
 * sub-policy one without a written reason simply cannot be expressed. `upsert_acu_rule` is the
 * narrow door where that rule lives.
 *
 * DELETE is a plain delete, because removing a rule needs no such judgement. What the rule has
 * already commanded stays in `commands`, which correctly has no delete policy of its own.
 */

import { supabase } from '@/config/supabase';
import { SITE } from '@shared/siteConfig.mjs';

export interface AcuRule {
  id: string;
  acuDeviceId: string;
  sensorDeviceId: string;
  /** The ROOM temperature to hold. Not the setpoint — the setpoint is the lever the loop moves. */
  targetC: number;
  deadbandC: number;
  stepC: number;
  minStepIntervalS: number;
  manualHoldS: number;
  /** 7 chars of '1'/'0', Mon..Sun — the same encoding schedules use. */
  days: string;
  windowStart: string;
  windowEnd: string;
  enabled: boolean;
  label: string | null;
  /** Present only when the target is below the site's room-comfort policy. */
  overrideReason: string | null;
  updatedBy: string | null;
}

/** What the daemon last decided, for the live status strip. */
export interface AcuLoopState {
  ruleId: string;
  commandedC: number | null;
  lastStepAt: string | null;
  lastDirection: 'up' | 'down' | null;
  lastReason: string | null;
  lastEvaluatedAt: string | null;
  alertKind: string | null;
  alertSince: string | null;
}

export type AcuRuleDraft = Omit<AcuRule, 'id' | 'updatedBy'> & { id?: string };

const RULE_SELECT =
  'id,acu_device_id,sensor_device_id,target_c,deadband_c,step_c,min_step_interval_s,manual_hold_s,days,window_start,window_end,enabled,label,override_reason,updated_by';
const STATE_SELECT = 'rule_id,commanded_c,last_step_at,last_direction,last_reason,last_evaluated_at,alert_kind,alert_since';

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured (VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY unset)');
  return supabase;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST rows are untyped at this boundary; every field is narrowed below. */
export function acuRuleFromRow(row: any): AcuRule {
  return {
    id: row.id,
    acuDeviceId: row.acu_device_id,
    sensorDeviceId: row.sensor_device_id,
    targetC: Number(row.target_c),
    deadbandC: Number(row.deadband_c),
    stepC: Number(row.step_c),
    minStepIntervalS: Number(row.min_step_interval_s),
    manualHoldS: Number(row.manual_hold_s),
    days: row.days,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    enabled: Boolean(row.enabled),
    label: row.label ?? null,
    overrideReason: row.override_reason ?? null,
    updatedBy: row.updated_by ?? null,
  };
}

export function acuLoopStateFromRow(row: any): AcuLoopState {
  return {
    ruleId: row.rule_id,
    commandedC: row.commanded_c ?? null,
    lastStepAt: row.last_step_at ?? null,
    lastDirection: row.last_direction ?? null,
    lastReason: row.last_reason ?? null,
    lastEvaluatedAt: row.last_evaluated_at ?? null,
    alertKind: row.alert_kind ?? null,
    alertSince: row.alert_since ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Rules and their state together.
 *
 * A deployment that has not applied phase36 answers `42P01`. Empty is the honest result there —
 * a site with no rules table has no rules — and the Event-Driven tab renders its empty state
 * rather than an error somebody can do nothing about.
 */
export async function fetchAcuRules(): Promise<{ rules: AcuRule[]; state: Record<string, AcuLoopState> }> {
  const client = requireSupabase();
  const [rules, state] = await Promise.all([
    client.from('acu_rules').select(RULE_SELECT),
    client.from('acu_loop_state').select(STATE_SELECT),
  ]);
  if (rules.error) {
    if (rules.error.code === '42P01') return { rules: [], state: {} };
    throw new Error(`Supabase acu_rules fetch failed: ${rules.error.message}`);
  }
  const byRule: Record<string, AcuLoopState> = {};
  for (const row of state.data ?? []) {
    const s = acuLoopStateFromRow(row);
    byRule[s.ruleId] = s;
  }
  return { rules: (rules.data ?? []).map(acuRuleFromRow), state: byRule };
}

/**
 * Creates or updates one rule.
 *
 * `overrideReason` is what permits a target below the building's room-comfort policy. The
 * function raises `check_violation` without one, and that message is surfaced verbatim — it
 * names both numbers and says what to do, which is more use than anything this layer could
 * rewrite it into.
 */
export async function saveAcuRule(draft: AcuRuleDraft): Promise<AcuRule> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('upsert_acu_rule', {
    p_id: draft.id ?? null,
    p_acu_device_id: draft.acuDeviceId,
    p_sensor_device_id: draft.sensorDeviceId,
    p_target_c: draft.targetC,
    p_deadband_c: draft.deadbandC,
    p_step_c: draft.stepC,
    p_min_step_interval_s: draft.minStepIntervalS,
    p_manual_hold_s: draft.manualHoldS,
    p_days: draft.days,
    p_window_start: draft.windowStart,
    p_window_end: draft.windowEnd,
    p_enabled: draft.enabled,
    p_label: draft.label,
    p_override_reason: draft.overrideReason,
    p_site_id: SITE.id,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('upsert_acu_rule returned nothing — check that supabase/phase36_acu_rules.sql has been applied.');
  return acuRuleFromRow(row);
}

export async function setAcuRuleEnabled(id: string, enabled: boolean): Promise<AcuRule> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('set_acu_rule_enabled', { p_id: id, p_enabled: enabled });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('set_acu_rule_enabled returned nothing');
  return acuRuleFromRow(row);
}

export async function deleteAcuRule(id: string): Promise<void> {
  const client = requireSupabase();
  const { data, error } = await client.from('acu_rules').delete().eq('id', id).select('id');
  if (error) throw new Error(`Supabase acu rule delete failed: ${error.message}`);
  // PostgREST reports an RLS-blocked delete as a plain 200 with an empty array, so without this
  // the rule would vanish from the page and keep stepping the setpoint.
  if ((data?.length ?? 0) !== 1) {
    throw new Error(`Supabase acu rule delete for ${id} affected 0 rows — check that you are signed in with a real Supabase session, not a break-glass one.`);
  }
}
