import type { PendingCommand } from '@/stores/commandStore';
import type { Reading, SocketIndex, SwitchState } from './types';

/**
 * What a control (a socket toggle, a switch toggle) should render right now — the pure
 * composition of the feed's truth and any pending optimistic command, kept as a resolver
 * function rather than duplicated JSX logic per caller. `deviceStore.latestReadings` never
 * holds an optimistic value (see `commandStore.ts`'s header) — this is where the two
 * actually meet, at render time, not in the store.
 */
export type ControlView =
  | { kind: 'idle'; value: SwitchState }
  | { kind: 'pending'; value: SwitchState; from: SwitchState | null }
  | { kind: 'failed'; value: SwitchState | null; desired: SwitchState; error: string }
  | { kind: 'unknown' };

export function controlView(reading: Reading | undefined, pending: PendingCommand | undefined, socket?: SocketIndex): ControlView {
  const observed = socket !== undefined ? reading?.socket_states?.[socket] : reading?.state;

  if (pending) {
    if (pending.phase === 'failed') {
      // The FEED value, not the desired one — the rollback is automatic and free, because
      // the optimistic value was never written into the readings store to begin with.
      return { kind: 'failed', value: observed ?? null, desired: pending.desired, error: pending.error ?? 'The command failed.' };
    }
    return { kind: 'pending', value: pending.desired, from: pending.observedBefore };
  }

  if (observed === undefined || observed === null) return { kind: 'unknown' };
  return { kind: 'idle', value: observed };
}
