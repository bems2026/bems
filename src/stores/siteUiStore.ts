/**
 * Which optional cards this site shows — RM-035.
 *
 * Deliberately simpler than `deviceConfigStore`: that one carries a draft/saved split because a
 * device's metadata is a form of several fields edited together and saved once. This is two
 * switches, and each flip is a committed edit, so a draft layer would be machinery with nothing
 * to hold. Same reasoning `spaceTreeStore` gives for the same choice.
 *
 * A FAILED LOAD RESOLVES TO THE DEFAULTS, NOT TO A SPINNER OR A RETRY LOOP. These preferences
 * decide whether two decorative cards render. If the row cannot be fetched, showing them is the
 * right answer and the page must not wait: blocking Control behind a request for a display
 * preference would trade a real capability — switching a relay — for a cosmetic one.
 */
import { create } from 'zustand';
import { supabase } from '@/config/supabase';
import { fetchSiteUi, saveSiteUi } from '@/lib/supabaseSiteUi';
import { SITE_UI_DEFAULTS, type SiteUiPrefs } from '@/lib/siteUi';

interface SiteUiState {
  prefs: SiteUiPrefs;
  /** The blob as stored, carried so a save can merge over keys this build does not know. */
  raw: unknown;
  /**
   * Whether these can be changed at all — i.e. whether Supabase is configured.
   *
   * Separate from `error` because it is a permanent property of the deployment rather than a
   * failure: local dev against `npm run mock` has none and never will, and a panel offering a
   * switch there is promising something it cannot do. Same distinction `spaceTreeStore.canEdit`
   * draws, and it was found in a browser rather than by a test.
   */
  canEdit: boolean;
  status: 'idle' | 'loading' | 'ready';
  saving: boolean;
  error: string | null;

  load: () => Promise<void>;
  setPref: (key: keyof SiteUiPrefs, value: boolean) => Promise<void>;
  clearError: () => void;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export const useSiteUiStore = create<SiteUiState>((set, get) => ({
  prefs: { ...SITE_UI_DEFAULTS },
  raw: null,
  canEdit: supabase !== null,
  status: 'idle',
  saving: false,
  error: null,

  load: async () => {
    set({ status: 'loading', error: null });
    if (!supabase) {
      // Not transient — the mock bridge has no Supabase. Resolving straight to the defaults is
      // correct; retrying would never succeed.
      set({ prefs: { ...SITE_UI_DEFAULTS }, raw: null, status: 'ready' });
      return;
    }
    try {
      const row = await fetchSiteUi();
      set({ prefs: row.prefs, raw: row.raw, status: 'ready' });
    } catch (err) {
      set({ prefs: { ...SITE_UI_DEFAULTS }, raw: null, status: 'ready', error: message(err) });
    }
  },

  /**
   * Flips one preference and saves immediately.
   *
   * OPTIMISTIC, THEN RECONCILED FROM THE DATABASE'S ANSWER. The switch moves at once because a
   * toggle that waits on a round trip feels broken on a Pi kiosk — but the value that sticks is
   * the one the row actually holds, so an RLS refusal reverts the switch rather than leaving it
   * showing a preference nobody has. The same "never claim more than was observed" rule the
   * command path follows.
   */
  setPref: async (key, value) => {
    if (!supabase) {
      set({ error: 'Supabase is not configured for this deployment, so these cannot be changed here.' });
      return;
    }
    const before = get().prefs;
    const next = { ...before, [key]: value };
    set({ prefs: next, saving: true, error: null });
    try {
      const actorUserId = (await supabase.auth.getSession()).data.session?.user.id ?? null;
      const row = await saveSiteUi(next, get().raw, actorUserId);
      set({ prefs: row.prefs, raw: row.raw, saving: false });
    } catch (err) {
      set({ prefs: before, saving: false, error: message(err) });
    }
  },

  clearError: () => set({ error: null }),
}));
