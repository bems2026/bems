/**
 * Finding the site's device of a kind, without naming it — FI-016.
 *
 * WHY THIS EXISTS. Four components looked up `acu_main`, `sens_outside_temp` or `l1` by literal
 * id. Each was really asking "the aircon", "the outdoor sensor" or "a lighting circuit", and
 * each answered it with this building's name for that thing — so at another site the aircon
 * card controls nothing, silently, because the id it sends to does not exist.
 *
 * `class` is the right key and is already the right shape: it is flow-critical and immutable
 * from the UI, and command validation, state shape, icons and filters all key off it. An id is
 * a name; a class is a capability.
 *
 * WHAT "PRIMARY" MEANS, stated because it is a real limitation rather than a detail. A building
 * with two aircons has two `acu_ir` devices and this returns the first by id. That is enough for
 * a card that shows "the indoor temperature" and wrong for a building that wants both — which is
 * a UI question nobody has had to answer yet, and which `devicesOfClass` is here to answer when
 * they do. What it must never do is silently pick one and imply it is all of them.
 */
import type { Device, DeviceClass } from './types';

/** Every device of a class, in stable id order — numeric-aware, so `l2` sorts before `l10`. */
export function devicesOfClass(devices: readonly Device[], cls: DeviceClass): Device[] {
  return devices.filter((d) => d.class === cls).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

/**
 * The site's primary device of a class, or `null` if it has none.
 *
 * `null` is a state callers must render, not one they may assume away: a site with no aircon
 * should show no aircon control, rather than a button that sends a command to nothing. That is
 * the same failure `SpaceTreePanel` shipped once, where a control was offered for a backend that
 * was not configured and threw on the first click.
 */
export function primaryOfClass(devices: readonly Device[], cls: DeviceClass): Device | null {
  return devicesOfClass(devices, cls)[0] ?? null;
}
