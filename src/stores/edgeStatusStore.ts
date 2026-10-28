import { create } from 'zustand';
import { fetchJson } from '@/lib/bridgeClient';
import { parseEdgeStatus, type EdgeStatus } from '@/lib/edgeLink';
import { createRetrySchedule } from './retrySchedule';

/**
 * Whether the edge reaches the cloud — RM-165. A read of the edge, not of the cloud, so polling it every minute
 * costs the hosted database nothing (RM-159), and it answers exactly when the cloud does not.
 */
const EDGE_STATUS_POLL_MS = 60_000;

const retry = createRetrySchedule();

interface EdgeStatusState {
  /** Null when the edge has not answered: an older proxy, or a page not served from the edge. Says nothing. */
  status: EdgeStatus | null;
  load: () => Promise<void>;
}

export const useEdgeStatusStore = create<EdgeStatusState>((set) => ({
  status: null,

  load: async () => {
    retry.cancel();
    const attempt = async (): Promise<void> => {
      try {
        const status = parseEdgeStatus(await fetchJson<unknown>('/edge/status', { timeoutMs: 10_000 }));
        retry.succeeded();
        set({ status });
        retry.scheduleNext(attempt, EDGE_STATUS_POLL_MS);
      } catch {
        set({ status: null });
        retry.retryAfterFailure(attempt);
      }
    };
    await attempt();
  },
}));
