import { create } from 'zustand';
import { supabase } from '@/config/supabase';
import { fetchSchedules, insertSchedule, updateSchedule, deleteSchedule, type Schedule } from '@/lib/supabaseSchedules';
import { createRetrySchedule } from './retrySchedule';
import type { SocketIndex } from '@/lib/types';

const retry = createRetrySchedule();

/** Everything a caller may change about a rule. `id` and attribution are the store's business. */
export type ScheduleDraft = {
  deviceId: string;
  socket: SocketIndex | null;
  on: string | null;
  off: string | null;
  days: string | null;
  enabled: boolean;
  label: string | null;
};

/** The key row-level status is filed under while a NEW rule is being created and has no id. */
export const CREATING = '__creating__';

interface ScheduleState {
  /** The `schedules` table as of the last successful read or write. */
  schedules: Schedule[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  loadError: string | null;
  /** Which rows have a write in flight, keyed by rule id (or `CREATING`). */
  busy: Record<string, boolean>;
  /** The last error per row, so a failure is reported next to the control that caused it
   * rather than in a page-level banner the reader has to go looking for. */
  rowError: Record<string, string | null>;
  /** The last successful write, for the inline "saved" confirmation. */
  lastSave: { at: number; id: string } | null;

  load: () => Promise<void>;
  create: (draft: ScheduleDraft) => Promise<Schedule | null>;
  /** Merges `patch` into the saved rule and writes the whole row — `rule` is one jsonb column,
   * so a partial write would clobber the fields it did not mention. */
  patch: (id: string, patch: Partial<ScheduleDraft>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clearRowError: (id: string) => void;
}

const draftOf = (s: Schedule): ScheduleDraft => ({
  deviceId: s.deviceId,
  socket: s.socket,
  on: s.on,
  off: s.off,
  days: s.days,
  enabled: s.enabled,
  label: s.label,
});

/**
 * The `schedules` table, as a list of rules with ids — RM-059.
 *
 * WHY THIS STORE EXISTS RATHER THAN MORE OF `contextStore`. Schedules used to live in the same
 * flat `ContextMap` as the DSM thresholds, keyed `global.schedule.<device>.<field>` — Node-RED's
 * old global-context convention, kept deliberately through the Supabase migration so the
 * components did not have to change. That key shape can hold exactly one rule per device: there
 * is nowhere to put the second one. Stacking is what forces the split, and `contextStore` keeps
 * the `global.dsm.*` half unchanged.
 *
 * IT SAVES IMMEDIATELY, which is the other deliberate difference. The staged draft plus one
 * "Write to Supabase" button is a reasonable model for a handful of threshold fields; it is a
 * poor one for a list you add to and delete from, because a queued deletion reads as already
 * done. `deviceConfigStore`'s load-shed tiers already save on change for the same reason. The
 * page keeps the staged model for thresholds, so both models are present on it — each on the
 * kind of control it suits.
 *
 * FAILURES ARE PER ROW. A write that fails leaves `saved` untouched and files the message under
 * that rule's id, so the row shows what went wrong and the rest of the stack stays usable.
 */
export const useScheduleStore = create<ScheduleState>((set, get) => ({
  schedules: [],
  status: 'idle',
  loadError: null,
  busy: {},
  rowError: {},
  lastSave: null,

  // Retries with backoff, same reasoning as `contextStore.load`. Unconfigured Supabase (local
  // dev against the mock, no VITE_SUPABASE_* set) is NOT transient — retrying it forever would
  // just spin — so it resolves straight to an empty, ready store.
  load: async () => {
    set({ status: 'loading', loadError: null });
    retry.cancel();
    if (!supabase) {
      set({ schedules: [], status: 'ready' });
      return;
    }
    const attempt = async (): Promise<void> => {
      try {
        const schedules = await fetchSchedules();
        retry.succeeded();
        set({ schedules, status: 'ready' });
      } catch (err) {
        set({ loadError: err instanceof Error ? err.message : 'Could not read the schedules.' });
        retry.retryAfterFailure(attempt);
      }
    };
    await attempt();
  },

  create: async (draft) => {
    set((s) => ({ busy: { ...s.busy, [CREATING]: true }, rowError: { ...s.rowError, [CREATING]: null } }));
    try {
      const row = await insertSchedule(draft);
      set((s) => ({
        schedules: [...s.schedules, row],
        busy: { ...s.busy, [CREATING]: false },
        lastSave: { at: Date.now(), id: row.id },
      }));
      return row;
    } catch (err) {
      set((s) => ({
        busy: { ...s.busy, [CREATING]: false },
        rowError: { ...s.rowError, [CREATING]: err instanceof Error ? err.message : 'The write failed.' },
      }));
      return null;
    }
  },

  patch: async (id, changes) => {
    const current = get().schedules.find((s) => s.id === id);
    if (!current) return;
    const next = { ...draftOf(current), ...changes };

    set((s) => ({ busy: { ...s.busy, [id]: true }, rowError: { ...s.rowError, [id]: null } }));
    try {
      const row = await updateSchedule(id, next);
      set((s) => ({
        schedules: s.schedules.map((x) => (x.id === id ? row : x)),
        busy: { ...s.busy, [id]: false },
        lastSave: { at: Date.now(), id },
      }));
    } catch (err) {
      // `schedules` is left exactly as it was, so the row snaps back to what the database
      // actually holds rather than showing an edit that did not land.
      set((s) => ({
        busy: { ...s.busy, [id]: false },
        rowError: { ...s.rowError, [id]: err instanceof Error ? err.message : 'The write failed.' },
      }));
    }
  },

  remove: async (id) => {
    set((s) => ({ busy: { ...s.busy, [id]: true }, rowError: { ...s.rowError, [id]: null } }));
    try {
      await deleteSchedule(id);
      set((s) => ({
        schedules: s.schedules.filter((x) => x.id !== id),
        busy: { ...s.busy, [id]: false },
        lastSave: { at: Date.now(), id },
      }));
    } catch (err) {
      // The row STAYS on screen. `deleteSchedule` checks the affected row count precisely so a
      // blocked delete cannot look like a success — a rule that vanished from the page while
      // still switching the building on its old timetable is the failure being prevented here.
      set((s) => ({
        busy: { ...s.busy, [id]: false },
        rowError: { ...s.rowError, [id]: err instanceof Error ? err.message : 'The delete failed.' },
      }));
    }
  },

  clearRowError: (id) => set((s) => ({ rowError: { ...s.rowError, [id]: null } })),
}));
