/**
 * Notes on the Reports page — RM-164: a note per day and remarks per report, kept in `report_notes`.
 *
 * Each note saves on its own, when the field loses focus, and carries its own state so the row can say
 * "Saved" or "Not saved" beside it. A failed save keeps what was typed, so nothing is lost to a slow link.
 * A deployment without the table (phase56 not yet pasted) says so once, and the fields go read-only.
 */
import { create } from 'zustand';
import { supabase } from '@/config/supabase';
import { fetchReportNotes, saveReportNote, NotesUnavailable, type NoteKind } from '@/lib/supabaseReportNotes';

export type NoteSaveState = 'saving' | 'saved' | 'failed';

export const noteKey = (kind: NoteKind, start: string) => `${kind}|${start}`;

interface ReportNotesState {
  /** `kind|start` -> the note as stored (or as typed, after a failed save). */
  notes: Record<string, string>;
  saveState: Record<string, NoteSaveState>;
  /** Null while notes can be read and written; otherwise why not (no database, or phase56 missing). */
  unavailable: string | null;
  error: string | null;
  loadedRange: string | null;
  load: (fromDay: string, toDay: string) => Promise<void>;
  save: (kind: NoteKind, start: string, text: string) => Promise<void>;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export const useReportNotesStore = create<ReportNotesState>((set, get) => ({
  notes: {},
  saveState: {},
  unavailable: supabase === null ? 'Notes need the account database, which this deployment has not configured.' : null,
  error: null,
  loadedRange: null,

  load: async (fromDay, toDay) => {
    if (supabase === null) return;
    try {
      const rows = await fetchReportNotes(fromDay, toDay);
      const notes = { ...get().notes };
      for (const r of rows) notes[noteKey(r.kind, r.start)] = r.note;
      set({ notes, unavailable: null, error: null, loadedRange: `${fromDay}..${toDay}` });
    } catch (err) {
      if (err instanceof NotesUnavailable) set({ unavailable: err.message });
      else set({ error: message(err) });
    }
  },

  save: async (kind, start, text) => {
    const key = noteKey(kind, start);
    const before = get().notes[key] ?? '';
    // A failed save left the typed text in `notes`, so "Try again" must not read it as unchanged.
    if (text.trim() === before.trim() && get().saveState[key] !== 'failed') return;
    set({ notes: { ...get().notes, [key]: text }, saveState: { ...get().saveState, [key]: 'saving' } });
    try {
      const actorUserId = supabase ? ((await supabase.auth.getSession()).data.session?.user.id ?? null) : null;
      const stored = await saveReportNote(kind, start, text, actorUserId);
      set({ notes: { ...get().notes, [key]: stored }, saveState: { ...get().saveState, [key]: 'saved' }, error: null });
    } catch (err) {
      if (err instanceof NotesUnavailable) set({ unavailable: err.message });
      set({ saveState: { ...get().saveState, [key]: 'failed' }, error: message(err) });
    }
  },
}));
