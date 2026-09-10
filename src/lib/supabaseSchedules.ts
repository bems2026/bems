/**
 * The `schedules` table, as a real list — RM-066.
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
  if (!supabase) throw new Error('Schedules need a settings store, which this deployment has not configured.');
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
  if (error) throw new Error(`Could not read the schedules: ${error.message}`);
  return (data ?? []).map((r) => scheduleFromRow(r as ScheduleRow));
}

/** The one refusal an operator actually hits and can act on, worded for the person. Matches
 * `supabaseConfig.ts`'s `BREAK_GLASS_HINT` verbatim so the page speaks with one voice. */
const NOT_SIGNED_IN = 'you are signed in with a limited local sign-in, which cannot save. Sign in with your account to make changes.';

/**
 * A database error, said in words an operator can act on.
 *
 * WHY THIS EXISTS. The page used to render whatever Postgres said, verbatim:
 *
 *   Could not add the schedule: duplicate key value violates unique constraint
 *   "schedules_dedupe_uidx"
 *
 * which names an index instead of a problem and tells the reader nothing about what to do. The
 * one that actually fires is `schedules_dedupe_uidx` — `phase33`'s hygiene index over
 * `(device_id, coalesce(socket,0), on, off, days)`. Adding a second rule while a blank one is
 * still sitting in the list trips it every time, because two blank rules ARE identical by that
 * key. That is a normal thing to do by accident, not a fault, so it should read like guidance.
 *
 * TRANSLATED HERE, at the boundary where the raw message enters the app, so every caller gets
 * the plain sentence and no component has to know what a `uidx` is. Anything unrecognised is
 * passed through rather than flattened into "something went wrong": an unfamiliar error the
 * reader can search for beats a friendly one that hides it.
 */
export function explainWriteError(error: { message: string; code?: string }, verb: 'add' | 'save'): string {
  const msg = error.message ?? '';
  if (error.code === '23505' || /duplicate key value|unique constraint/i.test(msg)) {
    if (/schedules_dedupe_uidx/.test(msg)) {
      return verb === 'add'
        ? 'This target already has a rule with these times and days. Fill in the blank rule already in the list, or change its times, before adding another.'
        : 'Another rule on this target already has these times and days. Two identical rules would do the same thing, so change one of them.';
    }
    return 'A rule like this already exists on this target.';
  }
  return `Could not ${verb} the schedule: ${msg}`;
}

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
  if (error) throw new Error(explainWriteError(error, 'add'));
  if ((data?.length ?? 0) !== 1) throw new Error(`The schedule was not added — ${NOT_SIGNED_IN}`);
  return scheduleFromRow(data![0] as ScheduleRow);
}

export async function updateSchedule(id: string, draft: Omit<Schedule, 'id' | 'updatedBy' | 'updatedAt' | 'createdAt'>): Promise<Schedule> {
  const client = requireSupabase();
  const actorUserId = await actor();
  if (!actorUserId) {
    throw new Error('Cannot save a schedule without a signed-in user: an unattributed rule would never fire.');
  }
  const { data, error } = await client.from('schedules').update(scheduleToRow(draft, actorUserId)).eq('id', id).select(SELECT);
  if (error) throw new Error(explainWriteError(error, 'save'));
  if ((data?.length ?? 0) !== 1) throw new Error(`The schedule was not saved — ${NOT_SIGNED_IN}`);
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
  if (error) throw new Error(`Could not delete the schedule: ${error.message}`);
  if ((data?.length ?? 0) !== 1) {
    // Without this check a blocked delete looks like a success: the row leaves the screen and
    // the rule keeps switching the building on its old timetable.
    throw new Error(`The schedule was not deleted — ${NOT_SIGNED_IN}`);
  }
}
