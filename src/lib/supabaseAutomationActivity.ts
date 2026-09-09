/**
 * What automation actually DID — the page's missing answer to "did it work?".
 *
 * WHY THIS EXISTS. Every unattended path in this system writes to `commands`: the scheduler
 * (`source: 'schedule'`), auto-shed (`'dsm_autoshed'`) and now the aircon loop (`'acu_loop'`).
 * Nothing in the app has ever read those rows back. So an operator who armed a schedule had two
 * ways to find out whether it fired — walk to the fixture, or read the journal on the Pi over
 * SSH — and the page that armed it said nothing at all.
 *
 * That gap is what let the page claim "nothing on the real bridge reads these yet" for months
 * while the daemon was switching relays. A feed of what really happened is the thing that makes
 * the corrected copy checkable rather than merely reworded.
 *
 * READ-ONLY, and `commands` has no UPDATE or DELETE policy for `authenticated` — this is the
 * audit trail, and the app's relationship to it is to display it.
 */

import { supabase } from '@/config/supabase';

/** The three unattended sources. A person's own command (`ibems-app`) is not automation. */
export const AUTOMATION_SOURCES = ['schedule', 'dsm_autoshed', 'acu_loop'] as const;
export type AutomationSource = (typeof AUTOMATION_SOURCES)[number];

export interface AutomationEvent {
  id: string;
  deviceId: string;
  socket: number | null;
  action: string;
  /** The aircon setpoint this asked for, when it was a setpoint change. */
  targetC: number | null;
  source: AutomationSource;
  /** `dispatched` | `dry_run` | `failed` | `dispatching`. Free text by design — see schema.sql. */
  status: string;
  requestedAt: string;
  note: string | null;
}

const SELECT = 'id,device_id,socket,action,target_c,source,status,requested_at,note';

/* eslint-disable @typescript-eslint/no-explicit-any -- a PostgREST row is untyped at this boundary. */
export function automationEventFromRow(row: any): AutomationEvent {
  return {
    id: row.id,
    deviceId: row.device_id,
    socket: row.socket ?? null,
    action: row.action,
    targetC: row.target_c ?? null,
    source: row.source,
    status: row.status,
    requestedAt: row.requested_at,
    note: row.note ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * The most recent unattended commands, newest first.
 *
 * `target_c` is selected unconditionally. A deployment that has not applied phase36 answers
 * `42703` (undefined column), and the retry below drops the field rather than losing the whole
 * feed — the same narrow, single-column fallback `auditedDispatch` uses for phase18's `via`, and
 * for the same reason: a nicety must not take out the thing it decorates.
 */
export async function fetchAutomationActivity(limit = 25, sinceHours = 24): Promise<AutomationEvent[]> {
  if (!supabase) return [];
  const since = new Date(Date.now() - sinceHours * 3600_000).toISOString();
  const sources = `(${AUTOMATION_SOURCES.join(',')})`;

  const query = (select: string) =>
    supabase!
      .from('commands')
      .select(select)
      .in('source', AUTOMATION_SOURCES as unknown as string[])
      .gte('requested_at', since)
      .order('requested_at', { ascending: false })
      .limit(limit);

  let { data, error } = await query(SELECT);
  if (error?.code === '42703') {
    ({ data, error } = await query(SELECT.replace(',target_c', '')));
  }
  if (error) throw new Error(`Could not read what automation did for ${sources}: ${error.message}`);
  return (data ?? []).map(automationEventFromRow);
}
