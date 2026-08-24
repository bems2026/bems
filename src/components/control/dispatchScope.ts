import { classesWhere } from '@/lib/deviceClassCatalog';
import type { Device, DeviceClass } from '@/lib/types';

/**
 * Which device classes this page can issue commands for at all — the catalog's `switchable`
 * set, since "can be commanded" and "has an on/off state" are the same fact.
 * sensors are read-only, so they can never be "commanded but not dispatched" and must not
 * appear in either half of the message below.
 */
export const COMMANDABLE_CLASSES: DeviceClass[] = classesWhere('switchable');

const LABELS: Record<string, string> = {
  switch: 'Lighting',
  outlet_dual: 'Outlets',
  acu_ir: 'the ACU',
};

export type DispatchState = 'closed' | 'partial' | 'full';

export interface DispatchScope {
  state: DispatchState;
  /** Commandable classes present here whose commands reach real hardware. */
  live: DeviceClass[];
  /** Commandable classes present here that are validated and logged but change nothing. */
  simulated: DeviceClass[];
}

/**
 * Splits what this page can command into "actually moves a relay" and "only looks like it".
 *
 * The banner this drives used to be a single boolean: closed, or absent. That was fine while
 * nothing dispatched. `server/proxy.mjs` now dispatches all three commandable classes —
 * `switch`, `outlet_dual` and `acu_ir` (see `dispatchLight.mjs`'s `DISPATCH_CLASSES`) — so the
 * asymmetry this was written for no longer exists on a fully-deployed Pi. It is kept because
 * the asymmetry is a property of the *deployment*, not of the code: a bridge missing the
 * outlet/aircon endpoints, or a partially-applied flow, still produces a page where some
 * controls move relays and others only look like they do. A binary banner would vanish the
 * moment the gate opened and silently imply everything is live. That is the misreading with
 * real-world cost, and it is the one this function exists to prevent.
 *
 * (This comment previously asserted that outlets and the ACU could never dispatch because no
 * endpoint existed. That stopped being true when those endpoints landed, and all three were
 * observed moving real hardware on 2026-08-24.)
 *
 * `dispatchClasses` comes from `GET /api/capabilities`, which derives it from the same
 * constant `handleCommand` branches on — so this can't drift from what the server will do.
 * `null` means "not yet loaded" and is deliberately treated as closed: never claim dispatch
 * is open before a real response says so.
 */
export function dispatchScope(devices: Device[], dispatchClasses: string[] | null): DispatchScope {
  const dispatching = new Set(dispatchClasses ?? []);
  const present = new Set(devices.map((d) => d.class));

  const commandablePresent = COMMANDABLE_CLASSES.filter((c) => present.has(c));
  const live = commandablePresent.filter((c) => dispatching.has(c));
  const simulated = commandablePresent.filter((c) => !dispatching.has(c));

  // No live class — including the case where there are no commandable devices at all — is
  // "closed". An empty page reported as "full" would read as an all-clear it hasn't earned.
  const state: DispatchState = live.length === 0 ? 'closed' : simulated.length === 0 ? 'full' : 'partial';
  return { state, live, simulated };
}

/** Joins labels as "A, B and C" — the ACU's label is lowercase on purpose so it reads as
 * "Outlets and the ACU" rather than "Outlets and The ACU". */
function list(classes: DeviceClass[]): string {
  const names = classes.map((c) => LABELS[c] ?? c);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Capitalises only the first character, leaving the rest of the sentence alone. */
const upperFirst = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export function dispatchScopeMessage(scope: DispatchScope): string {
  if (scope.state === 'closed') {
    return 'Hardware dispatch is closed — every command here is validated and audit-logged, but nothing on this page currently changes a real relay.';
  }
  if (scope.state === 'full') {
    return 'Hardware dispatch is open — every command on this page switches real hardware.';
  }
  return `${upperFirst(list(scope.live))} now switches real hardware. ${upperFirst(list(scope.simulated))} ${scope.simulated.length === 1 ? 'is' : 'are'} validated and audit-logged only — commands there change nothing yet.`;
}
