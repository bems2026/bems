import { create } from 'zustand';
import { sendCommand } from '@/lib/bridgeClient';
import { describeFailure } from '@/stores/commandStore';
import type { CapabilityValue } from '@/lib/types';

/**
 * In-flight capability writes — child lock, countdowns, the over-power alarm threshold.
 *
 * WHY THIS IS NOT `commandStore`. That store's optimistic machinery is built for relays and
 * only makes sense there: `PendingCommand.desired` is a `SwitchState`, and `reconcile()`
 * resolves an entry by comparing it against the relay state on the next reading. A capability
 * has no such shape — its value may be a boolean, a whole number of watts, or an enum string —
 * and forcing it through that path would mean either widening a type that is deliberately
 * narrow on a relay control, or pretending a threshold is a switch.
 *
 * So this store does less on purpose. It records that a write is in flight, and it records why
 * one failed. It does NOT hold an optimistic value: the reading is the only thing that says
 * what the device now holds, and a setting that appeared to change because we asked would be
 * exactly the lie `commandStore`'s header warns about, with no reconcile to catch it.
 *
 * That also matches what the server promises. A capability ack is `confirmed: false` for the
 * same reason a relay ack is — the device does not report the value back synchronously — so
 * the honest UI is "sent", then the value changing on its own when the device says so.
 */
export type CapabilityPhase = 'sending' | 'sent' | 'failed';

export interface CapabilityWrite {
  device_id: string;
  capability: string;
  value: CapabilityValue;
  phase: CapabilityPhase;
  error: string | null;
  at: number;
}

/** One in-flight write per device+capability. A second click replaces rather than queues. */
export const capabilityKey = (deviceId: string, capability: string) => `${deviceId}:${capability}`;

/** How long a finished entry stays visible before it is swept. */
export const SENT_LINGER_MS = 4000;
export const FAILED_LINGER_MS = 15000;

interface CapabilityState {
  writes: Record<string, CapabilityWrite>;
  setCapability: (deviceId: string, capability: string, value: CapabilityValue) => Promise<void>;
  /** Drops entries that have outlived their linger. Called from the shared clock, not a timer. */
  sweep: (nowMs?: number) => void;
}

export const useCapabilityStore = create<CapabilityState>((set, get) => ({
  writes: {},

  setCapability: async (deviceId, capability, value) => {
    const key = capabilityKey(deviceId, capability);
    set((s) => ({
      writes: { ...s.writes, [key]: { device_id: deviceId, capability, value, phase: 'sending', error: null, at: Date.now() } },
    }));

    try {
      await sendCommand({ device_id: deviceId, action: 'set', capability, value });
      // Superseded by a newer write to the same setting while this one was in flight — let that
      // one own the entry rather than overwriting it with a stale result.
      if (get().writes[key]?.value !== value) return;
      set((s) => ({ writes: { ...s.writes, [key]: { ...s.writes[key], phase: 'sent', at: Date.now() } } }));
    } catch (err) {
      if (get().writes[key]?.value !== value) return;
      set((s) => ({ writes: { ...s.writes, [key]: { ...s.writes[key], phase: 'failed', error: describeFailure(err), at: Date.now() } } }));
    }
  },

  sweep: (nowMs = Date.now()) => {
    const { writes } = get();
    let changed = false;
    const next: Record<string, CapabilityWrite> = {};
    for (const [key, w] of Object.entries(writes)) {
      const linger = w.phase === 'failed' ? FAILED_LINGER_MS : SENT_LINGER_MS;
      if (w.phase !== 'sending' && nowMs - w.at > linger) { changed = true; continue; }
      next[key] = w;
    }
    // Identity-preserving no-op, so subscribers do not re-render on every tick — the same rule
    // `commandStore.reconcile` follows.
    if (changed) set({ writes: next });
  },
}));

/** The write in flight for one setting, if any. */
export function writeFor(writes: Record<string, CapabilityWrite>, deviceId: string, capability: string) {
  return writes[capabilityKey(deviceId, capability)];
}
