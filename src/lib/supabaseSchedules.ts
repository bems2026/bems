/**
 * The `schedules` table, as a real list — RM-059.
 *
 * WHAT REPLACED WHAT. Until phase33 a device had exactly one schedule, enforced by
 * `unique (device_id)`, and this app expressed it as flat `global.schedule.<id>.<field>` keys
 * in a `ContextMap` (see `supabaseConfig.ts`, which still owns the DSM half of that map). That
 * key shape cannot express N rows per device — there is nowhere to put the second one — so
 * schedules leave the map entirely and become ordinary rows with ids.
 *
 * NO `upsert()` ANYWHERE IN THIS FILE, and that is the point rather than an omission. With `id`
 * as the only identity there is no natural key to conflict on, so writes are plain
 * insert / update-by-id / delete-by-id. That retires the whole class of problem
 * `phase6_schedules_unique_fix.sql` was fighting instead of re-solving it one level down.
 *
 * EVERY WRITE CHECKS THE ROW COUNT. PostgREST reports an RLS policy matching zero rows as a
 * plain 200 with an EMPTY array, not an error, so `{error}` alone stays null even when nothing
 * was written — confirmed live in this project, where a save reported success while both tables
 * stayed untouched. That applies to DELETE too, which is newer and easier to get wrong: without
 * the check, a blocked delete removes the row from the screen while the rule keeps firing.
 */

import { supabase } from '@/config/supabase';
import type { SocketIndex } from './types';

/** One rule in a device's stack. `socket` is null for a switch or the aircon. */
export interface Schedule {
  id: string;
  deviceId: string;
  socket: SocketIndex | null;
  /** `HH:MM`, or null when this rule only switches one way. */
  on: string | null;
  off: string | null;
  /** 7 chars of '1'/'0', Mon..Sun. See `@shared/scheduleDays.mjs`. */
  days: string | null;
  enabled: boolean;
  label: string | null;
  /**
   * Who saved it. NOT bookkeeping: `server/schedulePlan.mjs` attributes the command it fires to
   * this user and skips any row without one, because `commands.requested_by` is NOT NULL and a
   * fabricated user in the audit table is worse than a gap. A row with a null here is a rule
   * that silently never fires, which is why the UI surfaces it as a fault.
   */
  updatedBy: string | null;
  updatedAt: string | null;
  createdAt: string | null;
}

interface ScheduleRow {
  id: string;
  device_id: string;
  socket: number | null;
  rule: { on?: string | null; off?: string | null; days?: string | null } | null;
  enabled: boolean;
  label: string | null;
  updated_by: string | null;
  updated_at: string | null;
  created_at: string | null;
}

const SELECT = 'id,device_id,socket,rule,enabled,label,updated_by,updated_at,created_at';

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured (VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY unset)');
  return supabase;
}

/** Pure — exported for unit tests that need no live project, same pattern as `supabaseConfig`. */
export function scheduleFromRow(row: ScheduleRow): Schedule {
  return {
    id: row.id,
    deviceId: row.device_id,
    socket: (row.socket === 1 || row.socket === 2 ? row.socket : null) as SocketIndex | null,
    on: row.rule?.on ?? null,
    off: row.rule?.off ?? null,
    days: row.rule?.days ?? null,
    enabled: Boolean(row.enabled),
    label: row.label ?? null,
    updatedBy: row.updated_by ?? null,
    updatedAt: row.updated_at ?? null,
    createdAt: row.created_at ?? null,
  };
}

/**
 * The row a write sends. `rule` is one jsonb column, so it is always written whole — a partial
 * write would clobber the fields it did not mention, which is the trap `writeScheduleContext`
 * documented before this file existed.
 */
export function scheduleToRow(s: Omit<Schedule, 'id' | 'updatedBy' | 'updatedAt' | 'createdAt'>, actorUserId: string | null) {
  return {
    device_id: s.deviceId,
    socket: s.socket,
    rule: { on: s.on || null, off: s.off || null, days: s.days || null },
    enabled: s.enabled,
    label: s.label || null,
    updated_by: actorUserId,
    updated_at: new Date().toISOString(),
  };
}

/** The signed-in user, which every write must carry. See `Schedule.updatedBy`. */
async function actor(): Promise<string | null> {
  const client = requireSupabase();
  return (await client.auth.getSession()).data.session?.user.id ?? null;
}

export async function fetchSchedules(): Promise<Schedule[]> {
  const client = requireSupabase();
  // No `.is('socket', null)` — that filter is what made per-socket scheduling invisible to the
  // app for as long as it existed.
  const { data, error } = await client.from('schedules').select(SELECT);
  if (error) throw new Error(`Supabase schedules fetch failed: ${error.message}`);
  return (data ?? []).map((r) => scheduleFromRow(r as ScheduleRow));
}

const NOT_SIGNED_IN =
  'check that you are signed in with a real Supabase session, not a break-glass one';

export async function insertSchedule(draft: Omit<Schedule, 'id' | 'updatedBy' | 'updatedAt' | 'createdAt'>): Promise<Schedule> {
  const client = requireSupabase();
  const actorUserId = await actor();
  if (!actorUserId) {
    // Refused here rather than written and left inert. `schedulePlan` skips an unattributed row,
    // so a rule saved this way would sit on the page looking armed and never fire — the exact
    // failure that is invisible in a stack of five.
    throw new Error('Cannot save a schedule without a signed-in user: an unattributed rule would never fire.');
  }
  const { data, error } = await client.from('schedules').insert(scheduleToRow(draft, actorUserId)).select(SELECT);
  if (error) throw new Error(`Supabase schedule insert failed: ${error.message}`);
  if ((data?.length ?? 0) !== 1) throw new Error(`Supabase schedule insert returned no row — ${NOT_SIGNED_IN}.`);
  return scheduleFromRow(data![0] as ScheduleRow);
}

export async function updateSchedule(id: string, draft: Omit<Schedule, 'id' | 'updatedBy' | 'updatedAt' | 'createdAt'>): Promise<Schedule> {
  const client = requireSupabase();
  const actorUserId = await actor();
  if (!actorUserId) {
    throw new Error('Cannot save a schedule without a signed-in user: an unattributed rule would never fire.');
  }
  const { data, error } = await client.from('schedules').update(scheduleToRow(draft, actorUserId)).eq('id', id).select(SELECT);
  if (error) throw new Error(`Supabase schedule update failed: ${error.message}`);
  if ((data?.length ?? 0) !== 1) throw new Error(`Supabase schedule update for ${id} affected 0 rows — ${NOT_SIGNED_IN}.`);
  return scheduleFromRow(data![0] as ScheduleRow);
}

/**
 * Removes one rule.
 *
 * A HARD DELETE, and `phase33` added the DELETE policy that makes it possible — the table had
 * none, because with one row per device "clearing" a schedule was a write of nulls. `enabled =
 * false` already means DISARMED, a state the operator can see and toggle; reusing it for
 * removal would collapse two different things into one and leave the stack unreadable.
 *
 * Deleting a rule does not erase what it did: `commands` keeps every firing with its source,
 * its actor and the rule id in the note.
 */
export async function deleteSchedule(id: string): Promise<void> {
  const client = requireSupabase();
  const { data, error } = await client.from('schedules').delete().eq('id', id).select('id');
  if (error) throw new Error(`Supabase schedule delete failed: ${error.message}`);
  if ((data?.length ?? 0) !== 1) {
    // Without this check a blocked delete looks like a success: the row leaves the screen and
    // the rule keeps switching the building on its old timetable.
    throw new Error(`Supabase schedule delete for ${id} affected 0 rows — ${NOT_SIGNED_IN}.`);
  }
}
