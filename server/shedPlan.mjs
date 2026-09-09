/**
 * Automatic load shedding: given the live reading and the configured limits, which relays
 * (if any) should be switched off right now.
 *
 * Pure — no I/O, no clock. The decision to cut power to part of a working building is the
 * last place to accept "probably right", so it is all here and exhaustively tested, with
 * the daemon half reduced to fetching inputs and firing the result.
 *
 * Two rules do most of the safety work:
 *
 *   - **Shed only, never restore.** Switching load OFF unattended is recoverable by a person;
 *     switching it back ON is not, and an automatic restore oscillates against the very
 *     threshold that triggered it. Restoring is deliberately a human action.
 *   - **One tier per evaluation.** Shed group_1, re-measure, and only escalate to group_2 if
 *     still over. Sheds the least load that gets the building under its limit, instead of
 *     dropping everything the moment a threshold is touched.
 *
 * Nothing is ever shed unless it was explicitly assigned to a tier. "Protected" (`never`) and
 * unassigned targets are both left alone — a relay nobody classified is not a volunteer.
 *
 * SINCE RM-060 THE UNIT IS A SOCKET, NOT A DEVICE. An outlet is two relays behind one label and
 * one may be a fridge while the other is a kettle; tiering them together was a limitation of
 * where the tier was stored, never a statement about the building. Three consequences, each
 * marked below: targets are enumerated per socket, "is it on" is read per socket, and every
 * emitted command already names its socket — so the daemon's `fanOutCommand` call on this path
 * is gone rather than merely redundant.
 */

import { checkDsmBreach } from '../shared/dsmMath.mjs';

/** Shed order. `never` is absent by design, and an unassigned target matches no tier. */
export const SHED_TIERS = ['group_1', 'group_2', 'group_3'];

/**
 * Every relay that could be shed, with the tier that governs it.
 *
 * One entry per socket for an `outlet_dual`, one with `socket: null` for everything else. The
 * socket's own tier wins; the device-level tier is the fallback, which is what keeps a
 * pre-RM-060 configuration behaving exactly as it did — phase34's backfill writes those rows
 * explicitly, and this fallback covers the window before it is applied.
 *
 * @param {{devices: Array, configs: Record<string,string|null>,
 *          socketConfigs: Record<string, Record<number, string|null>>}} args
 * @returns {Array<{device_id: string, socket: number|null, tier: string|null}>}
 */
export function shedTargets({ devices, configs, socketConfigs }) {
  const out = [];
  for (const device of devices ?? []) {
    const deviceTier = configs?.[device.id] ?? null;
    if (device.class === 'outlet_dual') {
      // From the registry, never a hard-coded 2.
      const count = device.sockets?.length ?? 0;
      for (let n = 1; n <= count; n += 1) {
        out.push({ device_id: device.id, socket: n, tier: socketConfigs?.[device.id]?.[n] ?? deviceTier });
      }
    } else {
      out.push({ device_id: device.id, socket: null, tier: deviceTier });
    }
  }
  return out;
}

/**
 * Whether this particular relay is drawing right now.
 *
 * PER SOCKET for an outlet: `shared/buildLatest.mjs` emits `socket_states` from the measured
 * `switch_1`/`switch_2` dps, and the device-level `state` is *derived* as `s1 || s2`. Shedding
 * on the derived value would switch off a socket that was already off — a pointless command and
 * a misleading audit row — every time its neighbour was on.
 *
 * A reading with no `socket_states` at all (an older bridge) is treated as NOT sheddable rather
 * than as on: a fabricated "on" produces exactly the pointless command above, and the existing
 * rule here has always been that an unknown state is not a volunteer.
 */
function isOn(reading, socket) {
  if (socket === null) return reading?.state === 'on';
  const states = reading?.socket_states;
  if (!states) return false;
  return states[socket] === 'on';
}

/**
 * @param {object}  args
 * @param {{maxPhaseA:number|null, maxTotalKw:number|null, autoShed:boolean}} args.thresholds
 * @param {object|null} args.totals            the current `_totals` reading
 * @param {Array} args.devices                 registry entries: {id, class, sockets}
 * @param {Record<string,string|null>} args.configs        device id -> device-level tier
 * @param {Record<string,Record<number,string|null>>} args.socketConfigs  device id -> socket -> tier
 * @param {Record<string,{state?:string, socket_states?:object}>} args.readings
 * @param {string[]} args.dispatchableDeviceIds  devices with a real dispatch path
 * @param {string|null} args.actorUserId         who configured the thresholds
 * @returns {{breached:boolean, reason:string|null, tier:string|null, shed:Array}}
 */
export function planShed({ thresholds, totals, devices, configs, socketConfigs, readings, dispatchableDeviceIds, actorUserId }) {
  const { breached, reason } = checkDsmBreach(thresholds, totals);
  const idle = { breached, reason, tier: null, shed: [] };

  if (!breached) return idle;
  // The breach is still reported when auto-shed is off — an operator wants to know they are
  // over the limit even when they have not asked the system to do anything about it.
  if (!thresholds.autoShed) return idle;
  // No attribution, no switching. `commands.requested_by` is NOT NULL, and a load-shed event
  // is the last row in that table anyone would want traced to an invented user.
  if (!actorUserId) return idle;

  const dispatchable = new Set(dispatchableDeviceIds);
  const targets = shedTargets({ devices, configs, socketConfigs });

  for (const tier of SHED_TIERS) {
    const hits = targets.filter(
      (t) => t.tier === tier && dispatchable.has(t.device_id) && isOn(readings?.[t.device_id], t.socket),
    );
    if (hits.length === 0) continue; // nothing left in this tier — try the next one down
    return {
      breached,
      reason,
      tier,
      shed: hits
        .sort((a, b) => a.device_id.localeCompare(b.device_id) || (a.socket ?? 0) - (b.socket ?? 0))
        .map((t) => ({
          device_id: t.device_id,
          // Already addressed. Nothing downstream needs to expand this, which is why the
          // daemon's `fanOutCommand` call on the shed path was removed rather than left in as
          // a harmless no-op — a second place that can expand a target is a second place that
          // can double one.
          socket: t.socket,
          action: 'off',
          requested_by: actorUserId,
          source: 'dsm_autoshed',
        })),
    };
  }

  // Over the limit with nothing left that may be shed. Reported, not forced: the remaining
  // load is either protected or unassigned, and overriding that would defeat the point of
  // marking it.
  return idle;
}
