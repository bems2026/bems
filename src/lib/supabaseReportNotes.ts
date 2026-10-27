/**
 * `report_notes` reads and writes — RM-164. Straight from the browser, RLS-gated to `authenticated`, the
 * pattern of `supabaseSiteUi.ts`. One row per day note (`kind: 'day'`) and per report's remarks
 * (`kind: 'week' | 'month' | 'year'`, `start` = the period's first day). See supabase/phase56_report_notes.sql.
 */

import { supabase } from '@/config/supabase';
import { SITE } from '@shared/siteConfig.mjs';

export type NoteKind = 'day' | 'week' | 'month' | 'year';

export interface ReportNote {
  kind: NoteKind;
  start: string;
  note: string;
}

/** The table is not there yet: phase56 has not been pasted. Said as such, not as a failure. */
export class NotesUnavailable extends Error {}

const MISSING_TABLE = /report_notes|PGRST205|42P01|does not exist|schema cache/i;

function requireSupabase() {
  if (supabase === null) throw new NotesUnavailable('Notes need the account database, which this deployment has not configured.');
  return supabase;
}

/** Every note whose `start` falls in `[fromDay, toDay]` — the period's day notes and its own remarks, in one request. */
export async function fetchReportNotes(fromDay: string, toDay: string): Promise<ReportNote[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('report_notes')
    .select('kind,start,note')
    .eq('site_id', SITE.id)
    .gte('start', fromDay)
    .lte('start', toDay);
  if (error) {
    if (MISSING_TABLE.test(`${error.code ?? ''} ${error.message}`)) throw new NotesUnavailable('Notes need supabase/phase56_report_notes.sql applied in the SQL editor.');
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => ({ kind: r.kind as NoteKind, start: String(r.start).slice(0, 10), note: r.note ?? '' }));
}

/** Saves one note; an empty one clears it (the row stays, with who cleared it). */
export async function saveReportNote(kind: NoteKind, start: string, note: string, actorUserId: string | null): Promise<string> {
  const client = requireSupabase();
  const text = note.trim().slice(0, 2000);
  const { data, error } = await client
    .from('report_notes')
    .upsert({ site_id: SITE.id, kind, start, note: text, updated_by: actorUserId, updated_at: new Date().toISOString() }, { onConflict: 'site_id,kind,start' })
    .select('note')
    .maybeSingle();
  if (error) {
    if (MISSING_TABLE.test(`${error.code ?? ''} ${error.message}`)) throw new NotesUnavailable('Notes need supabase/phase56_report_notes.sql applied in the SQL editor.');
    throw new Error(error.message);
  }
  return data?.note ?? text;
}
