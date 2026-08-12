import { create } from 'zustand';
import { getContext, saveContext } from '@/lib/bridgeClient';
import type { ContextMap } from '@/lib/types';

/** Keys in `draft` not yet reflected in `saved` — what a "Write to Node-RED context" click
 * would actually send. Pure so Automation's "Pending context writes" list can render the
 * exact same diff `save()` acts on, not a separately-tracked dirty set that could drift. */
export function pendingWrites(draft: ContextMap, saved: ContextMap): ContextMap {
  const out: ContextMap = {};
  for (const [key, value] of Object.entries(draft)) {
    if (saved[key] !== value) out[key] = value;
  }
  return out;
}

function withoutKeys(map: ContextMap, keys: string[]): ContextMap {
  const out = { ...map };
  for (const key of keys) delete out[key];
  return out;
}

interface ContextState {
  /** The mock's context store as of the last successful `load()`/`save()` — the source of
   * truth for "what Node-RED's schedule subflow would actually read right now." */
  saved: ContextMap;
  /** Local edits not yet written. A key here overrides `saved` for display purposes but
   * has no effect anywhere until `save()` succeeds — same optimistic-but-separate pattern
   * `commandStore` uses for device control (see that file's header). */
  draft: ContextMap;
  status: 'idle' | 'loading' | 'ready' | 'error';
  saveStatus: 'idle' | 'saving' | 'error';
  saveError: string | null;
  load: () => Promise<void>;
  setDraft: (key: string, value: string) => void;
  save: () => Promise<void>;
}

/**
 * Node-RED global-context state for Automation's schedules/triggers/DSM thresholds — and,
 * critically, the DSM keys Overview's load-shed banner reads (see `OverviewPage.tsx`).
 * Loaded once at app start (`App.tsx`), not lazily on Automation's mount, because the
 * banner needs a real breach state regardless of which page is currently active.
 */
export const useContextStore = create<ContextState>((set, get) => ({
  saved: {},
  draft: {},
  status: 'idle',
  saveStatus: 'idle',
  saveError: null,

  load: async () => {
    set({ status: 'loading' });
    try {
      const saved = await getContext();
      set({ saved, status: 'ready' });
    } catch {
      set({ status: 'error' });
    }
  },

  setDraft: (key, value) => set((s) => ({ draft: { ...s.draft, [key]: value } })),

  save: async () => {
    const { draft, saved } = get();
    const pending = pendingWrites(draft, saved);
    if (Object.keys(pending).length === 0) return;

    set({ saveStatus: 'saving', saveError: null });
    try {
      await saveContext(pending);
      set((s) => ({
        saved: { ...s.saved, ...pending },
        draft: withoutKeys(s.draft, Object.keys(pending)),
        saveStatus: 'idle',
      }));
    } catch (err) {
      set({ saveStatus: 'error', saveError: err instanceof Error ? err.message : 'The context write failed.' });
    }
  },
}));
