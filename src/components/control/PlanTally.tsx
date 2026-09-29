import type { Device, SocketIndex } from '@/lib/types';
import { useRelayTally, tallyText } from './relayTally';

/**
 * A plan panel's one-line state: "0 of 7 on", "12 of 14 sockets on · 2 unavailable".
 *
 * Its own component so the whole-map subscription in `useRelayTally` re-renders one line of text,
 * not the plan under it. Not a live region: it changes with every reading, and announcing each change
 * would talk over the command result an operator is actually waiting to hear.
 *
 * `sockets` must be a stable reference (a module constant), or the tally recounts on every render.
 */
export function PlanTally({ devices, sockets, unit }: { devices: Device[]; sockets?: (SocketIndex | undefined)[]; unit?: string }) {
  const tally = useRelayTally(devices, sockets);
  return (
    <span className={`control-plan-tally${tally.on > 0 ? ' control-plan-tally--on' : ''}`}>
      <span className="control-plan-tally__dot" aria-hidden="true" />
      {tallyText(tally, unit)}
    </span>
  );
}
