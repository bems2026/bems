import { create } from 'zustand';
import { supabase } from '@/config/supabase';
import { fetchTroubleEpisodes } from '@/lib/supabaseCapabilityHistory';
import type { CapabilityEpisode } from '@/lib/capabilityEpisodes';
import { createRetrySchedule } from './retrySchedule';

/**
 * How often to re-ask for trouble episodes.
 *
 * FIVE MINUTES, NOT ONE, and the difference from `anomaliesStore`'s cadence is deliberate rather
 * than an oversight. An anomaly is computed fresh every ingest tick and a new one can land in any
 * of them. An episode is a stretch of a WEEK-long window: it can only appear when a device has
 * been reporting a fault, a power warning or `no_net` for at least one tick, and it stays in the
 * window for seven days afterwards. Polling that at the anomaly rate would issue three queries a
 * minute, for the app's lifetime, to learn something that changes on the order of days.
 */
const TROUBLE_POLL_MS = 5 * 60_000;

const retry = createRetrySchedule();

interface CapabilityTroubleState {
  /** Episodes from the last successful fetch, newest first. A dumb cache, like
   * `anomaliesStore.rows` — `AlertsPopover` decides what is worth showing. */
  episodes: CapabilityEpisode[];
  status: 'idle' | 'loading' | 'ready';
  load: () => Promise<void>;
}

/**
 * The phase28 columns, asked the questions they were stored for — see
 * `src/lib/supabaseCapabilityHistory.ts`.
 *
 * AN EMPTY RESULT IS THE COMMON CASE AND IS NOT A FAILURE. Checked on the live database
 * 2026-09-08: zero rows with `fault <> 0`, zero with `power_type = warn`, zero with
 * `net_state = no_net`. A healthy fleet reports no episodes, and this store being `ready` with
 * nothing in it is what says so — which is why `status` is kept separate from the list rather
 * than inferring "loading" from emptiness.
 *
 * Degrades to an empty-but-`ready` store when Supabase is not configured, like every other
 * Supabase-backed store here.
 */
export const useCapabilityTroubleStore = create<CapabilityTroubleState>((set) => ({
  episodes: [],
  status: 'idle',

  load: async () => {
    set({ status: 'loading' });
    retry.cancel();
    if (!supabase) {
      set({ episodes: [], status: 'ready' });
      return;
    }
    const attempt = async (): Promise<void> => {
      try {
        const episodes = await fetchTroubleEpisodes();
        retry.succeeded();
        set({ episodes, status: 'ready' });
        retry.scheduleNext(attempt, TROUBLE_POLL_MS);
      } catch {
        retry.retryAfterFailure(attempt);
      }
    };
    await attempt();
  },
}));
