/**
 * Automatic load shedding: given the live reading and the configured limits, which devices
 * (if any) should be switched off right now.
 *
 * Pure — no I/O, no clock. The decision to cut power to part of a working building is the
 * last place to accept "probably right", so it is all here and exhaustively tested, with
 * `server/autoShed`'s daemon half reduced to fetching inputs and firing the result.
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
 * unassigned devices are both left alone — a device nobody classified is not a volunteer.
 */

import { checkDsmBreach } from '../shared/dsmMath.mjs';

/** Shed order. `never` is absent by design, and an unassigned device matches no tier. */
export const SHED_TIERS = ['group_1', 'group_2', 'group_3'];

/**
 * @param {object}  args
 * @param {{maxPhaseA:number|null, maxTotalKw:number|null, autoShed:boolean}} args.thresholds
 * @param {object|null} args.totals            the current `_totals` reading
 * @param {Record<string,string|null>} args.configs   device id -> load-shed group
 * @param {Record<string,{state?:string}>} args.readings  device id -> latest reading
 * @param {string[]} args.dispatchableDeviceIds  devices with a real dispatch path
 * @param {string|null} args.actorUserId         who configured the thresholds
 * @returns {{breached:boolean, reason:string|null, tier:string|null, shed:Array}}
 */
export function planShed({ thresholds, totals, configs, readings, dispatchableDeviceIds, actorUserId }) {
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
  const isSheddable = (deviceId, tier) =>
    configs[deviceId] === tier && dispatchable.has(deviceId) && readings[deviceId]?.state === 'on';

  for (const tier of SHED_TIERS) {
    const targets = Object.keys(configs).filter((deviceId) => isSheddable(deviceId, tier));
    if (targets.length === 0) continue; // nothing left in this tier — try the next one down
    return {
      breached,
      reason,
      tier,
      shed: targets.sort().map((deviceId) => ({
        device_id: deviceId,
        socket: null,
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
