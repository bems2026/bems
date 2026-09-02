import { useDeviceStore } from '@/stores/deviceStore';
import { useCommandStore, targetKey } from '@/stores/commandStore';
import { controlView, isCommandable } from '@/lib/socketView';
import { isReadingStale } from '@/lib/staleness';
import type { SocketIndex } from '@/lib/types';

/**
 * The state of one relay control, without the button.
 *
 * Exported because callers render their own wording beside the toggle ("switching…", "no
 * reading yet") and that wording has to agree with whether the button is actually disabled.
 * Two independent derivations of the same thing is what this component set out to remove.
 */
export function useRelayState(deviceId: string, socket?: SocketIndex) {
  const reading = useDeviceStore((s) => s.latestReadings[deviceId]);
  const pending = useCommandStore((s) => s.pending[targetKey(deviceId, socket)]);
  const view = controlView(reading, pending, socket);

  const busy = view.kind === 'pending';
  const unknown = view.kind === 'unknown';
  const on = !unknown && view.value === 'on';

  return {
    view,
    busy,
    unknown,
    on,
    /** Refused while in flight, with no state to toggle from, or when the bridge says offline. */
    disabled: busy || unknown || !isCommandable(reading),
    stale: isReadingStale(reading),
    /** "switching…" / "no reading yet" / "on" / "off" — one spelling, shared. */
    label: unknown ? 'no reading yet' : busy ? 'switching…' : on ? 'on' : 'off',
  };
}

