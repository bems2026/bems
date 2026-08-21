import { create } from 'zustand';
import { supabase } from '@/config/supabase';
import { fetchRecentAnomalies, type AnomalyRow } from '@/lib/supabaseAnomalies';
import { createRetrySchedule } from './retrySchedule';

/** How often to re-poll once a load has succeeded. Unlike contextStore/deviceConfigStore
 * (load once — that data barely changes at runtime), a new anomaly can land any ingest
 * tick, so this keeps polling for the app's lifetime — same self-rescheduling shape as
 * useAnalyticsHistory.ts's long-range poll loop. Slower than the ingest daemon's own 60s
 * cadence: the bell only needs to notice within a poll cycle or two, not instantly. */
const ANOMALIES_POLL_MS = 60_000;

const retry = createRetrySchedule();

interface AnomaliesState {
  /** Raw rows from the last successful fetch — AlertsPopover.tsx derives "current, one per
   * device" from this via src/lib/anomalies.ts's pure helpers, so this store stays a dumb
   * cache, same division of labor deviceStore.latestReadings + staleness.ts use. */
  rows: AnomalyRow[];
  status: 'idle' | 'loading' | 'ready';
  load: () => Promise<void>;
}

/**
 * Supabase-backed `anomalies` state — architecture plan Phase 8. Loaded once at app start
 * (useLiveConnection.ts), then keeps re-polling itself; degrades to an empty-but-'ready'
 * store when Supabase isn't configured, same as contextStore.ts/deviceConfigStore.ts.
 */
export const useAnomaliesStore = create<AnomaliesState>((set) => ({
  rows: [],
  status: 'idle',

  load: async () => {
    set({ status: 'loading' });
    retry.cancel();
    if (!supabase) {
      set({ rows: [], status: 'ready' });
      return;
    }
    const attempt = async (): Promise<void> => {
      try {
        const rows = await fetchRecentAnomalies();
        retry.succeeded();
        set({ rows, status: 'ready' });
        retry.scheduleNext(attempt, ANOMALIES_POLL_MS);
      } catch {
        retry.retryAfterFailure(attempt);
      }
    };
    await attempt();
  },
}));
