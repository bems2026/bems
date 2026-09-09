/**
 * DSM-thresholds config — architecture plan Phase 6, narrowed by RM-066. Reads and writes
 * Supabase's `dsm_thresholds` table directly from the browser (RLS-gated to `authenticated`,
 * same pattern as `supabaseHistory.ts`'s Phase 4 reads — no general CRUD backend needed).
 *
 * IT USED TO CARRY SCHEDULES TOO, in the same flat `ContextMap` shape
 * (`global.schedule.<id>.<field>`) that Node-RED's global context used and that this app kept
 * deliberately through the Supabase migration so the components did not have to change. That
 * key shape can hold exactly ONE rule per device — there is nowhere to put the second one — so
 * RM-066 moved schedules to `supabaseSchedules.ts` as ordinary rows with ids, and the
 * translation layer here shrank to the DSM half it still serves.
 *
 * `care_acu_trigger_c` IS NEITHER READ NOR WRITTEN — RM-065 removed the ambient-trigger slider
 * because nothing consumed the value, and both halves had to go together: dropping only the read
 * would have left `dsmRowFrom` sending `num(undefined)` — `null` — so the next demand-limit save
 * would have silently wiped the stored setpoint. RM-065 left the column out of the payload so
 * the value survived "for whoever builds the rule"; RM-069 is that rule, so `phase35` drops the
 * column outright. Nothing here names it either way.
 *
 * `contextStore.ts`'s `load`/`save` internals are the only callers.
 */

import { supabase } from '@/config/supabase';
import type { ContextMap } from './types';
import { SITE } from '@shared/siteConfig.mjs';

/** The one refusal an operator actually hits and can act on: a break-glass sign-in has no
 * account to attribute a write to, so row-level security rejects it — and PostgREST reports
 * that rejection as an ordinary success with zero rows. Worded for the person, once, so the
 * call sites below cannot drift apart. */
const BREAK_GLASS_HINT = 'you are signed in with a limited local sign-in, which cannot save. Sign in with your account to make changes.';

const MAX_PHASE_KEY = 'global.dsm.max_phase_a';
const MAX_TOTAL_KEY = 'global.dsm.max_total_kw';
const AUTO_SHED_KEY = 'global.dsm.auto_shed';

interface DsmThresholdsRow {
  max_phase_current: number | null;
  max_total_kw: number | null;
  auto_shed: boolean;
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
  if (!supabase) throw new Error('Schedules and limits need a settings store, which this deployment has not configured.');
  return supabase;
}

/** Pure — exported separately for unit testing without a live Supabase project, same
 * pattern as `supabaseHistory.ts`'s `mapReadingsRows`. */
export function dsmRowToContext(row: DsmThresholdsRow | null): ContextMap {
  if (!row) return {};
  const ctx: ContextMap = {};
  if (row.max_phase_current !== null) ctx[MAX_PHASE_KEY] = String(row.max_phase_current);
  if (row.max_total_kw !== null) ctx[MAX_TOTAL_KEY] = String(row.max_total_kw);
  ctx[AUTO_SHED_KEY] = String(row.auto_shed);
  return ctx;
}

/**
 * The DSM singleton's update payload.
 *
 * `updated_by` is load-bearing rather than bookkeeping: `server/shedPlan.mjs` takes its shed
 * actor from this column and returns an idle plan without one, because `commands.requested_by`
 * is NOT NULL and a fabricated user in the audit table is worse than a gap. A write that omits
 * it produces thresholds that can never shed — which is exactly the state RM-006c describes,
 * and why arming auto-shed needs a save from a signed-in session rather than a flag flip.
 *
 * `updated_at` is set explicitly because the column's `default now()` only applies on INSERT,
 * and this is an update over a row that already exists.
 */
export function dsmRowFrom(merged: ContextMap, actorUserId: string | null) {
  return {
    max_phase_current: num(merged[MAX_PHASE_KEY]),
    max_total_kw: num(merged[MAX_TOTAL_KEY]),
    auto_shed: merged[AUTO_SHED_KEY] === 'true',
    updated_by: actorUserId,
    updated_at: new Date().toISOString(),
  };
}

/** Everything `contextStore.load()` needs, in the one shape the DSM components already read. */
export async function fetchScheduleContext(): Promise<ContextMap> {
  const client = requireSupabase();
  const thresholds = await client
    .from('dsm_thresholds')
    .select('max_phase_current,max_total_kw,auto_shed')
    .eq('site_id', SITE.id)
    .maybeSingle();
  if (thresholds.error) throw new Error(`Could not read the demand limits: ${thresholds.error.message}`);
  return dsmRowToContext(thresholds.data);
}

/**
 * Writes the DSM thresholds when any of their keys changed.
 *
 * `merged` is `{...saved, ...pending}` because the row is written whole — a partial write would
 * clobber the untouched fields beside it.
 */
export async function writeScheduleContext(pending: ContextMap, merged: ContextMap): Promise<void> {
  const client = requireSupabase();
  // Same source of truth for "who is acting" that deviceConfigStore already uses.
  const actorUserId = (await client.auth.getSession()).data.session?.user.id ?? null;

  const dsmChanged = Object.keys(pending).some((key) => key === MAX_PHASE_KEY || key === MAX_TOTAL_KEY || key === AUTO_SHED_KEY);
  if (!dsmChanged) return;

  const { data, error } = await client
    .from('dsm_thresholds')
    .update(dsmRowFrom(merged, actorUserId))
    // RM-027: by site, not by the id=1 that `check (id = 1)` used to guarantee. phase20 dropped
    // that constraint and replaced it with `unique (site_id)`, so this is the write that matches.
    .eq('site_id', SITE.id)
    .select('site_id');
  if (error) throw new Error(`Could not save the demand limits: ${error.message}`);
  // .select() and a row-count check are load-bearing, not decoration: PostgREST reports an RLS
  // policy silently matching zero rows as a plain 200 with an EMPTY array, so `{error}` alone
  // stays null even when nothing was written. Confirmed live — a save once reported success
  // while both tables stayed completely untouched.
  if ((data?.length ?? 0) !== 1) {
    throw new Error(`The demand limits were not saved — ${BREAK_GLASS_HINT}`);
  }
}
