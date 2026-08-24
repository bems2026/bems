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

/**
 * Whether a control may be operated — deliberately independent of whether its reading is
 * fresh.
 *
 * These are two different facts travelling in opposite directions. Telemetry comes *from* the
 * device and can lag for reasons that say nothing about reachability; a command goes *to* it
 * through the proxy and the bridge. Gating the second on the first cost the outlets their
 * controls entirely: nothing polls an outlet (FI-013), so its reading is stale almost always,
 * and `disabled={… || stale}` meant an outlet was only operable in the seconds after it
 * happened to push a change of its own accord. Lights escaped it purely because they report
 * continuously. `IrCommandCenterCard` had already declined to make this conflation.
 *
 * `online: false` is a real refusal and stays one — the bridge is saying it has no connection
 * to the device, so a dispatch would not land. Everything else is permitted, including a
 * device that has never reported: `controlView` returns `unknown` there, and that is what
 * gates the toggle, because a toggle with no known state has nothing to toggle *from*.
 */
export function isCommandable(reading: Reading | undefined): boolean {
  return reading?.online !== false;
}
