import { create } from 'zustand';
import { getCapabilities, nextPollDelayMs } from '@/lib/bridgeClient';

let loadAttempt = 0;
let loadRetryTimer: ReturnType<typeof setTimeout> | null = null;

interface CapabilitiesState {
  /** `null` until the first successful load — deliberately treated the SAME as `false`
   * everywhere the UI reads this (see `ControlPage.tsx`'s dispatch banner): never claim
   * hardware dispatch is open before it's actually confirmed open. */
  hardwareDispatchEnabled: boolean | null;
  load: () => Promise<void>;
}

/**
 * Whether `POST /api/command`'s hardware-dispatch gate is open — architecture plan Phase
 * 6. Loaded once at app start alongside the device catalogue (`useLiveConnection.ts`), not
 * lazily on Control's mount, so the very first render of the dispatch banner is already
 * accurate rather than defaulting open for one frame.
 */
export const useCapabilitiesStore = create<CapabilitiesState>((set) => ({
  hardwareDispatchEnabled: null,

  // Same retry-with-backoff shape as useLiveConnection.ts's device-catalogue fetch — a
  // failed load here must never get stuck reporting "unknown" forever just because one
  // request over a real network hop dropped.
  load: async () => {
    if (loadRetryTimer) {
      clearTimeout(loadRetryTimer);
      loadRetryTimer = null;
    }
    const attempt = async (): Promise<void> => {
      try {
        const { hardware_dispatch_enabled } = await getCapabilities();
        loadAttempt = 0;
        set({ hardwareDispatchEnabled: hardware_dispatch_enabled });
      } catch {
        loadAttempt++;
        loadRetryTimer = setTimeout(attempt, nextPollDelayMs(loadAttempt));
      }
    };
    await attempt();
  },
}));
