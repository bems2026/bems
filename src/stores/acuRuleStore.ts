import { create } from 'zustand';
import { supabase } from '@/config/supabase';
import {
  fetchAcuRules,
  saveAcuRule,
  setAcuRuleEnabled,
  deleteAcuRule,
  type AcuRule,
  type AcuRuleDraft,
  type AcuLoopState,
} from '@/lib/supabaseAcuRules';
import { createRetrySchedule } from './retrySchedule';

const retry = createRetrySchedule();

/** The key row-level status is filed under while a NEW rule is being created and has no id. */
export const CREATING_RULE = '__creating_acu_rule__';

interface AcuRuleState {
  rules: AcuRule[];
  /** What the daemon last decided per rule — the live status strip reads this. */
  loopState: Record<string, AcuLoopState>;
  status: 'idle' | 'loading' | 'ready';
  loadError: string | null;
  busy: Record<string, boolean>;
  rowError: Record<string, string | null>;

  load: () => Promise<void>;
  save: (draft: AcuRuleDraft) => Promise<AcuRule | null>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clearRowError: (id: string) => void;
}

/**
 * Closed-loop aircon rules — RM-069.
 *
 * Saves on change, per rule, like `scheduleStore` and for the same reason: a list you add to and
 * delete from is the wrong shape for staged writes, because a queued deletion reads as one that
 * already happened.
 *
 * `loopState` is READ-ONLY here. The daemon owns it, writing with the service-role key; this
 * store only renders it, which is what turns "the rule is configured and nothing is happening"
 * from a suspicion into a sentence.
 */
export const useAcuRuleStore = create<AcuRuleState>((set) => ({
  rules: [],
  loopState: {},
  status: 'idle',
  loadError: null,
  busy: {},
  rowError: {},

  load: async () => {
    set({ status: 'loading', loadError: null });
    retry.cancel();
    // Unconfigured Supabase (local dev against the mock) is not transient — retrying it forever
    // would only spin — so it resolves straight to an empty, ready store.
    if (!supabase) {
      set({ rules: [], loopState: {}, status: 'ready' });
      return;
    }
    const attempt = async (): Promise<void> => {
      try {
        const { rules, state } = await fetchAcuRules();
        retry.succeeded();
        set({ rules, loopState: state, status: 'ready' });
      } catch (err) {
        set({ loadError: err instanceof Error ? err.message : 'Could not read the aircon rules.' });
        retry.retryAfterFailure(attempt);
      }
    };
    await attempt();
  },

  save: async (draft) => {
    const key = draft.id ?? CREATING_RULE;
    set((s) => ({ busy: { ...s.busy, [key]: true }, rowError: { ...s.rowError, [key]: null } }));
    try {
      const row = await saveAcuRule(draft);
      set((s) => ({
        rules: s.rules.some((r) => r.id === row.id) ? s.rules.map((r) => (r.id === row.id ? row : r)) : [...s.rules, row],
        busy: { ...s.busy, [key]: false },
      }));
      return row;
    } catch (err) {
      // The message is passed through verbatim. When the target is below the building's policy
      // the function's own text names both numbers and says a written reason is what unlocks it
      // — more use than anything this layer could rewrite it into.
      set((s) => ({
        busy: { ...s.busy, [key]: false },
        rowError: { ...s.rowError, [key]: err instanceof Error ? err.message : 'The write failed.' },
      }));
      return null;
    }
  },

  setEnabled: async (id, enabled) => {
    set((s) => ({ busy: { ...s.busy, [id]: true }, rowError: { ...s.rowError, [id]: null } }));
    try {
      const row = await setAcuRuleEnabled(id, enabled);
      set((s) => ({ rules: s.rules.map((r) => (r.id === id ? row : r)), busy: { ...s.busy, [id]: false } }));
    } catch (err) {
      set((s) => ({
        busy: { ...s.busy, [id]: false },
        rowError: { ...s.rowError, [id]: err instanceof Error ? err.message : 'The write failed.' },
      }));
    }
  },

  remove: async (id) => {
    set((s) => ({ busy: { ...s.busy, [id]: true }, rowError: { ...s.rowError, [id]: null } }));
    try {
      await deleteAcuRule(id);
      set((s) => ({ rules: s.rules.filter((r) => r.id !== id), busy: { ...s.busy, [id]: false } }));
    } catch (err) {
      // The rule STAYS on screen: `deleteAcuRule` checks the affected row count precisely so a
      // blocked delete cannot look like a success, leaving a rule that vanished from the page
      // while still stepping a setpoint.
      set((s) => ({
        busy: { ...s.busy, [id]: false },
        rowError: { ...s.rowError, [id]: err instanceof Error ? err.message : 'The delete failed.' },
      }));
    }
  },

  clearRowError: (id) => set((s) => ({ rowError: { ...s.rowError, [id]: null } })),
}));

/** Convenience for the status strip: the loop state for one rule, or an empty shape. */
export const loopStateFor = (id: string): AcuLoopState =>
  useAcuRuleStore.getState().loopState[id] ?? {
    ruleId: id,
    commandedC: null,
    lastStepAt: null,
    lastDirection: null,
    lastReason: null,
    lastEvaluatedAt: null,
    alertKind: null,
    alertSince: null,
  };
