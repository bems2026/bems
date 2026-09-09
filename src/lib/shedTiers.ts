/**
 * What load shedding can and cannot reach, as data — RM-006c.
 *
 * Pure, so the panel that renders it has no rules of its own. Every rule here mirrors
 * `server/shedPlan.mjs`, which is the thing that actually switches power; a UI that showed a
 * different set than the shedder acts on would be worse than no UI, because it would be believed.
 *
 * SINCE RM-067 THE UNIT IS A SOCKET. `shedPlan.shedTargets` enumerates one target per socket of
 * a dual outlet, so this does too — and the counts below therefore mean SHED POINTS, not
 * devices. That distinction is the whole reason this file and the panel changed in the same
 * commit: a panel still saying "3 devices" while the shedder sheds 5 sockets would be exactly
 * the believed-but-wrong UI the paragraph above refuses to ship.
 *
 * `shedPlan`'s conditions, and this file exists to make all three visible rather than one:
 *   1. the device is explicitly assigned to a tier — "a device nobody classified is not a
 *      volunteer", so unassigned and `never` are both left alone;
 *   2. it has a real dispatch path — otherwise the tier is inert and nothing happens;
 *   3. it is currently on — you cannot shed what is already off.
 *
 * MEASURED CONTEXT, so nobody plans around a capability that is not there. On this building,
 * 14 days of office hours (`npm run shed:profile`): 919 W of metered demand, of which everything
 * a relay can switch is 29 W. Lighting is 1.8%. The aircon is 33% and is not on a relay at all —
 * it is IR-commanded, and the compressor is deliberately never power-cut. Tiers are still worth
 * setting, because a tier is PERMISSION rather than size and an outlet averaging 1 W may be
 * 400 W the afternoon somebody plugs a kettle in.
 */
import type { Device, DeviceClass, Reading, SocketIndex } from './types';
import type { LoadShedGroup } from './deviceConfig';

/** The classes a relay can switch. A meter measures and a sensor reports; the aircon is reached
 * by IR, which does not cut power. Matching `shedPlan`'s reality rather than listing every
 * device and letting the operator discover which ones do nothing. */
export const SHEDDABLE_CLASSES: readonly DeviceClass[] = ['outlet_dual', 'switch'];

export const isSheddableClass = (cls: DeviceClass): boolean => SHEDDABLE_CLASSES.includes(cls);

/** Shed order, first to last. `never` is absent by design — it is not a tier, it is a refusal. */
export const SHED_ORDER: readonly LoadShedGroup[] = ['group_1', 'group_2', 'group_3'];

export interface ShedRow {
  device: Device;
  /** 1 or 2 for a dual outlet, null for a device with one relay. */
  socket: SocketIndex | null;
  /** "Outlet 3 · S1", or the device name where there is only one relay. */
  name: string;
  /** Stable identity for a row: `device` or `device:socket`. */
  key: string;
  tier: LoadShedGroup | null;
  /** Whether a command to this device would actually reach hardware right now. A tier on a
   * device with no dispatch path is inert — `shedPlan` checks this too. */
  dispatchable: boolean;
  /** Whether it is on. You cannot shed what is already off; shown so a tier that will do nothing
   * this minute does not look broken. */
  on: boolean;
}

export interface ShedSummary {
  rows: ShedRow[];
  /** Devices that cannot be shed at all, with the reason — rendered rather than hidden, so the
   * absence of the aircon from this list is explained instead of noticed. */
  excluded: { device: Device; reason: string }[];
  /** Per tier: how many SHED POINTS carry it, and how many of those could act right now.
   * Points, not devices — an outlet contributes two, and they may sit in different tiers. */
  byTier: Record<LoadShedGroup | 'unassigned', { total: number; effective: number }>;
  /** Assigned to a tier but unable to act — the number worth surfacing, because it is the gap
   * between what the configuration says and what would happen. */
  inertCount: number;
}

const EMPTY = () => ({ total: 0, effective: 0 });

/**
 * @param devices the fleet
 * @param tierOf  device id -> its configured tier, or null
 * @param readings latest readings by device id
 * @param dispatchableClasses classes the bridge reports it can really command, or null when the
 *   capabilities response has not arrived — treated as "unknown", never as "yes".
 *
 *   Typed as plain strings, matching `capabilitiesStore`. The bridge is entitled to name a class
 *   this build has never heard of, and narrowing it to `DeviceClass` here would be claiming
 *   knowledge the wire does not carry.
 */
export function summariseShed(
  devices: readonly Device[],
  tierOf: (id: string, socket: SocketIndex | null) => LoadShedGroup | null,
  readings: Record<string, Reading | undefined>,
  dispatchableClasses: readonly string[] | null,
): ShedSummary {
  const rows: ShedRow[] = [];
  const excluded: { device: Device; reason: string }[] = [];

  for (const device of devices) {
    if (!isSheddableClass(device.class)) {
      excluded.push({ device, reason: reasonNotSheddable(device.class) });
      continue;
    }
    // `null` capabilities means not yet known. Claiming dispatchable before the bridge has
    // said so is the same mistake `dispatchScope` refuses to make.
    const dispatchable = dispatchableClasses !== null && dispatchableClasses.includes(device.class);
    const reading = readings[device.id];

    if (device.class === 'outlet_dual') {
      // Socket count from the registry, never a hard-coded 2 — the same rule the runtime
      // fan-out and `shedTargets` both keep.
      const count = device.sockets?.length ?? 0;
      for (let n = 1; n <= count; n += 1) {
        const socket = n as SocketIndex;
        rows.push({
          device,
          socket,
          name: `${device.display_name} · S${n}`,
          key: `${device.id}:${n}`,
          tier: tierOf(device.id, socket),
          dispatchable,
          // PER SOCKET, mirroring `shedPlan.isOn`: the device-level `state` is derived as
          // `s1 || s2`, so using it here would show a socket as sheddable because its
          // neighbour is drawing. A reading with no `socket_states` is not assumed on.
          on: reading?.socket_states?.[socket] === 'on',
        });
      }
      continue;
    }

    rows.push({
      device,
      socket: null,
      name: device.display_name,
      key: device.id,
      tier: tierOf(device.id, null),
      dispatchable,
      on: reading?.state === 'on',
    });
  }

  const byTier: ShedSummary['byTier'] = {
    group_1: EMPTY(), group_2: EMPTY(), group_3: EMPTY(), never: EMPTY(), unassigned: EMPTY(),
  };
  let inertCount = 0;
  for (const row of rows) {
    const key = row.tier ?? 'unassigned';
    byTier[key].total += 1;
    // "Effective" means this device would be switched if its tier came up: assigned to a real
    // shed tier, dispatchable, and on. Exactly `shedPlan`'s three conditions.
    const effective = row.tier !== null && row.tier !== 'never' && row.dispatchable && row.on;
    if (effective) byTier[key].effective += 1;
    if (row.tier !== null && row.tier !== 'never' && !row.dispatchable) inertCount += 1;
  }

  return { rows, excluded, byTier, inertCount };
}

/**
 * Why a device is not in the list, in the fewest words that are still true. Shortened on operator
 * request (2026-09-08) — the aircon's read "reached by IR, which sends a command rather than
 * cutting power — the compressor is deliberately never relay-cut", which explains the mechanism
 * to someone who only needs to know it is not an oversight.
 */
function reasonNotSheddable(cls: DeviceClass): string {
  if (cls === 'meter') return 'a meter has no relay to switch';
  if (cls === 'sensor_temp_humidity') return 'a sensor only reports; it switches nothing';
  if (cls === 'acu_ir') return 'controlled by its remote, not a relay — its power is never cut';
  return 'this class has no relay';
}

/**
 * How many devices are assigned to a real shed tier — the question "can auto-shed ever do
 * anything here?" reduces to.
 *
 * WHY IT IS ASSIGNMENT AND NOT `effective`. `byTier[t].effective` also requires the device to be
 * dispatchable and currently on, and both of those are transient: a device that is off now may be
 * on in an hour, and a class the bridge cannot command yet may become commandable. Assignment is
 * the only condition whose absence makes auto-shed PERMANENTLY inert, and that is the one worth
 * refusing to arm over. The transient gap is already reported separately as `inertCount`.
 *
 * `never` and `unassigned` are both excluded, because `shedPlan` excludes both — "a device
 * nobody classified is not a volunteer", and `never` is an explicit refusal.
 */
export function shedEligibleCount(byTier: ShedSummary['byTier']): number {
  return SHED_ORDER.reduce((n, tier) => n + byTier[tier].total, 0);
}
