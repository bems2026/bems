/**
 * Why an armed schedule can never fire — ONE implementation, imported by both halves.
 *
 * WHY NOT A MIRROR. This project's precedent is `src/lib/shedTiers.ts` mirroring
 * `server/shedPlan.mjs` "rule for rule", with a comment explaining that a UI disagreeing with
 * the thing that switches power "would be worse than no UI, because it would be believed". That
 * mirror exists because one file is browser TypeScript and the other is daemon JavaScript.
 * `shared/` is how this repo avoids paying that cost twice — it is why `shared/commands.mjs`
 * exists — so the reasons a rule is dead are decided here, once, and both sides import them.
 *
 * The check order is load-bearing: it decides which of two simultaneous faults gets reported,
 * and a page naming a different one from the daemon would send somebody to fix the wrong thing.
 */

/** Every reason this module can return. Exhaustive, and tested to be reachable. */
export const UNFIREABLE_REASONS = Object.freeze([
  'unknown_device',
  'not_dispatchable',
  'no_attribution',
  'malformed_days',
  'no_times',
  'socket_not_applicable',
  'socket_not_on_device',
]);

/** Plain-language text for each, so the daemon's log line and the page say the same thing. */
export const UNFIREABLE_TEXT = Object.freeze({
  unknown_device: 'this device is not in the registry, so nothing can address it',
  not_dispatchable: 'this device has no dispatch path, so a firing would be recorded but nothing would move',
  no_attribution: 'saved without a signed-in user — the scheduler skips unattributed rules rather than invent one for the audit trail',
  malformed_days: 'no days are selected, so this rule matches no minute of the week',
  no_times: 'neither an on nor an off time — unfinished, not broken',
  socket_not_applicable: 'this device has no sockets, so naming one addresses nothing',
  socket_not_on_device: 'this device does not have that socket',
});

import { parseDays } from './scheduleDays.mjs';

/**
 * @param {{enabled: boolean, socket: number|null, updatedBy: string|null,
 *          days: string|null, on: string|null, off: string|null}} rule
 *        Field names deliberately match the browser's `Schedule` shape; the daemon adapts its
 *        snake_case row at the call site, which is one three-line function rather than a second
 *        copy of these rules.
 * @param {{class: string, sockets?: string[]}|undefined} device
 * @param {Set<string>} dispatchableIds
 * @returns {string|null} one of UNFIREABLE_REASONS, or null when the rule is fine
 *
 * A DISARMED rule returns null. Disarmed is a state an operator chose and can see; reporting it
 * as a fault would bury the real ones in noise.
 */
export function scheduleProblem(rule, device, dispatchableIds) {
  if (!rule?.enabled) return null;
  if (!device) return 'unknown_device';
  if (!dispatchableIds.has(rule.deviceId)) return 'not_dispatchable';
  // No attribution, no command: `commands.requested_by` is NOT NULL and inventing a user to
  // satisfy it would put a fiction in the one table meant to be trustworthy. Survivable when a
  // device held one row and somebody noticed it go quiet; invisible as one rule out of five.
  if (!rule.updatedBy) return 'no_attribution';
  if (!parseDays(rule.days ?? undefined).some(Boolean)) return 'malformed_days';
  // Neither time set matches no minute. Not malformed — UNFINISHED, which is a different thing
  // to tell somebody and the commonest half-made rule there is.
  if (!rule.on && !rule.off) return 'no_times';
  if (rule.socket !== null && rule.socket !== undefined) {
    if (device.class !== 'outlet_dual') return 'socket_not_applicable';
    if (!Number.isInteger(rule.socket) || rule.socket < 1 || rule.socket > (device.sockets?.length ?? 0)) {
      return 'socket_not_on_device';
    }
  }
  return null;
}

/** Adapts a `schedules` table row to the shape above. The daemon's only concession to sharing. */
export function ruleFromRow(row) {
  return {
    enabled: Boolean(row?.enabled),
    deviceId: row?.device_id,
    socket: row?.socket ?? null,
    updatedBy: row?.updated_by ?? null,
    days: row?.rule?.days ?? null,
    on: row?.rule?.on ?? null,
    off: row?.rule?.off ?? null,
  };
}
