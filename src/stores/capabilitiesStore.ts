import { create } from 'zustand';
import { getCapabilities } from '@/lib/bridgeClient';
import { createRetrySchedule } from './retrySchedule';

const retry = createRetrySchedule();

interface CapabilitiesState {
  /** `null` until the first successful load — deliberately treated the SAME as `false`
   * everywhere the UI reads this (see `ControlPage.tsx`'s dispatch banner): never claim
   * hardware dispatch is open before it's actually confirmed open. */
  hardwareDispatchEnabled: boolean | null;
  /** Which device classes actually reach hardware right now. `null` until the first
   * successful load — deliberately distinct from `[]`, which is the server positively
   * confirming that nothing dispatches. `components/control/dispatchScope.ts` treats both as
   * closed, but only one of them is a fact we were actually told. */
  dispatchClasses: string[] | null;
  /**
   * Command audit rows sitting in the Pi's local buffer because Supabase could not be
   * reached. `null` until a proxy actually reports it — a proxy predating the field is
   * unknown, not zero, for the same reason `dispatchClasses` distinguishes the two.
   */
  auditBufferPending: number | null;
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
  dispatchClasses: null,
  auditBufferPending: null,

  // Same retry-with-backoff shape as useLiveConnection.ts's device-catalogue fetch — a
  // failed load here must never get stuck reporting "unknown" forever just because one
  // request over a real network hop dropped.
  load: async () => {
    retry.cancel();
    const attempt = async (): Promise<void> => {
      try {
        const { hardware_dispatch_enabled, dispatch_classes, audit_buffer_pending } = await getCapabilities();
        retry.succeeded();
        set({
          hardwareDispatchEnabled: hardware_dispatch_enabled,
          // A proxy old enough to predate this field is reported as null (unknown) rather
          // than [], for the same reason the initial value is null: absence of an answer is
          // not the same as an answer of "nothing".
          dispatchClasses: Array.isArray(dispatch_classes) ? dispatch_classes : null,
          auditBufferPending: typeof audit_buffer_pending === 'number' ? audit_buffer_pending : null,
        });
      } catch {
        retry.retryAfterFailure(attempt);
      }
    };
    await attempt();
  },
}));
