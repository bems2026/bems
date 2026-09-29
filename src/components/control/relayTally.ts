import { useMemo } from 'react';
import { controlView, isCommandable } from '@/lib/socketView';
import { useDeviceStore } from '@/stores/deviceStore';
import { useCommandStore, targetKey, type PendingCommand } from '@/stores/commandStore';
import type { Device, Reading, SocketIndex } from '@/lib/types';

/**
 * How many of a panel's relays are on — the line beside each plan panel's label.
 *
 * WHY IT EXISTS. The plan's bulk buttons ("All rows on" / "All rows off") act on seven relays at
 * once, and nothing on the panel said what state those seven were in. You had to read the colour of
 * each lamp, and the colours themselves were the page's confusion. One sentence answers the question
 * before the click: "0 of 7 on".
 *
 * THE SAME DERIVATION AS THE TOGGLES. Each relay goes through `controlView`, exactly like
 * `useRelayState`, so a relay that is switching counts as the state it was asked for, and the count
 * can never disagree with the lamp drawn beside it. A relay nobody can switch — no reading yet, or the
 * bridge reports the device offline — is "unavailable", not on or off: it keeps a last state, but the
 * page refuses to switch it, and counting it would promise a control that is not there.
 *
 * `sockets` is `[undefined]` for a whole-device relay and `[1, 2]` for a dual outlet, whose two
 * sockets are counted separately because they are switched separately.
 */
export interface RelayTally {
  on: number;
  off: number;
  unavailable: number;
  total: number;
}

export function tallyRelays(
  devices: Device[],
  readings: Record<string, Reading | undefined>,
  pending: Record<string, PendingCommand | undefined>,
  sockets: (SocketIndex | undefined)[] = [undefined],
): RelayTally {
  const tally: RelayTally = { on: 0, off: 0, unavailable: 0, total: 0 };
  for (const d of devices) {
    const reading = readings[d.id];
    for (const socket of sockets) {
      tally.total += 1;
      const view = controlView(reading, pending[targetKey(d.id, socket)], socket);
      if (view.kind === 'unknown' || !isCommandable(reading)) tally.unavailable += 1;
      else if (view.value === 'on') tally.on += 1;
      else tally.off += 1;
    }
  }
  return tally;
}

/** "2 of 7 on", "10 of 14 sockets on", and " · 1 unavailable" only when there are some. */
export function tallyText(t: RelayTally, unit?: string): string {
  const base = `${t.on} of ${t.total}${unit ? ` ${unit}` : ''} on`;
  return t.unavailable > 0 ? `${base} · ${t.unavailable} unavailable` : base;
}

/**
 * The tally for a panel, live. Subscribes to the two whole maps, which is what a count needs — and
 * why it lives in its own small component (`PlanTally`), so that re-rendering on every reading costs
 * one line of text rather than the plan beneath it.
 */
export function useRelayTally(devices: Device[], sockets?: (SocketIndex | undefined)[]): RelayTally {
  const readings = useDeviceStore((s) => s.latestReadings);
  const pending = useCommandStore((s) => s.pending);
  return useMemo(() => tallyRelays(devices, readings, pending, sockets), [devices, readings, pending, sockets]);
}
