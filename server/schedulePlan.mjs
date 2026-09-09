/**
 * Pure scheduling maths: given the `schedules` rows and the current time, which commands are
 * due right now. No I/O, so the part most likely to be subtly wrong is also the part that is
 * exhaustively unit-testable — see schedulePlan.test.mjs.
 *
 * The week encoding — and the Mon..Sun vs `Date.getDay()` rotation that is the single most
 * dangerous detail in this area — now lives in `shared/scheduleDays.mjs`, imported by both
 * this daemon and the Automation page. It used to be implemented twice, here and in
 * `src/components/automation/automationMath.ts`, each with a comment claiming it mirrored the
 * other exactly. `appDayIndex` is re-exported below because schedulePlan.test.mjs pins the
 * rotation through this module's own surface, and that assertion is worth keeping where the
 * scheduling rules are.
 *
 * SINCE RM-059 a device holds MANY schedule rows, each naming its own socket. That changes
 * almost nothing in `dueCommands` — it always looped rows and always carried `row.socket`
 * through — and changes two things around it, both of which live in `resolveDue`.
 */

import { appDayIndex, parseDays, hhmm } from '../shared/scheduleDays.mjs';
import { fanOutCommand } from '../shared/commands.mjs';
import { scheduleProblem, ruleFromRow, UNFIREABLE_REASONS } from '../shared/scheduleRules.mjs';

export { appDayIndex };

/**
 * @param {Array} rows      `schedules` rows: {id, device_id, socket, rule:{on,off,days}, enabled, updated_by}
 * @param {Date}  now       evaluated to the minute, in the Pi's local time — schedules are
 *                          written by people looking at a wall clock, not at UTC
 * @param {{dispatchableDeviceIds: string[]}} opts
 *        Only these devices produce commands. A device with no dispatch path would otherwise
 *        write `dry_run` audit rows for switching that genuinely happened elsewhere, which is
 *        worse than not recording it at all.
 * @returns {Array} `{device_id, socket, action, requested_by, source, schedule_id}`
 *
 * RAW MATCHES, NOT THE FINAL COMMAND SET: an outlet row with a null socket is still unexpanded
 * here, and two rows can still collide on one target. `resolveDue` is what a caller should use.
 * This stays exported because it is the smallest testable unit of "does this row match this
 * minute", and sixteen tests pin it.
 */
export function dueCommands(rows, now, { dispatchableDeviceIds }) {
  const dispatchable = new Set(dispatchableDeviceIds);
  const nowHhmm = hhmm(now);
  const todayIndex = appDayIndex(now);
  const out = [];

  for (const row of rows ?? []) {
    if (!row?.enabled) continue;
    if (!dispatchable.has(row.device_id)) continue;
    // No attribution, no command. `commands.requested_by` is NOT NULL and inventing a user to
    // satisfy it would put a fiction in the one table meant to be trustworthy.
    if (!row.updated_by) continue;
    if (!parseDays(row.rule?.days)[todayIndex]) continue;

    // Checked in this order so that a schedule with on and off at the same minute resolves to
    // off. Ambiguous either way; off is the one that fails safe.
    let action = null;
    if (row.rule?.on === nowHhmm) action = 'on';
    if (row.rule?.off === nowHhmm) action = 'off';
    if (!action) continue;

    out.push({
      device_id: row.device_id,
      socket: row.socket ?? null,
      action,
      requested_by: row.updated_by,
      source: 'schedule',
      schedule_id: row.id ?? null,
    });
  }
  return out;
}

/** The collapse key. A switch's `null` socket and socket 1 are different targets, and spelling
 * `null` out keeps `0` from colliding with absence the way an empty string would. */
const targetKey = (cmd) => `${cmd.device_id}|${cmd.socket === null || cmd.socket === undefined ? 'null' : cmd.socket}`;

/** Whether a socket number is one this device actually has. `null` always passes: on an outlet
 * it means "both" and fans out, and on anything else it is the only possible value. */
function socketExistsOn(device, socket) {
  if (socket === null || socket === undefined) return true;
  if (!device) return false;
  if (device.class !== 'outlet_dual') return false;
  return Number.isInteger(socket) && socket >= 1 && socket <= (device.sockets?.length ?? 0);
}

/**
 * Every command due right now, in its FINAL addressed form: at most one per
 * `(device_id, socket)`.
 *
 * THE ORDER OF THE THREE STEPS IS THE WHOLE POINT, and it is why the fan-out lives here rather
 * than in the daemon where it used to. Match -> fan out -> collapse.
 *
 * Collapsing BEFORE the fan-out does not work, and the failure is not hypothetical. Suppose a
 * pre-phase33 whole-outlet row survives beside its two migrated children — an interrupted
 * migration, a restored backup, a hand edit — all three saying "off at 18:00" for `co5`. At
 * 18:00 the raw matches are keyed `(co5,null)`, `(co5,1)` and `(co5,2)`: three genuinely
 * different keys that no collapse can merge. The daemon's old `flatMap(fanOutCommand)` then
 * expanded the first into `(co5,1)` and `(co5,2)`, giving FOUR dispatches for two relays.
 * Absolute set makes that idempotent at the relay, so nothing visibly breaks — but the audit
 * trail then claims four commands where the operator configured two, and it doubles traffic to
 * a fleet whose inbound socket-table exhaustion is a documented fault. Expanding first makes
 * all three collapse onto two keys, which is the honest answer.
 *
 * OFF WINS A COLLISION, across rows as well as within one. `dueCommands` has always resolved
 * `on === off` inside a single row to `off`; with a stack, two DIFFERENT rows can be due for
 * one target in the same minute. Without this rule the outcome would depend on PostgREST's row
 * order, which is unordered. Off is the one that fails safe, so it is the one that wins.
 *
 * A ROW NAMING A SOCKET ITS DEVICE DOES NOT HAVE PRODUCES NOTHING. `resolveTarget` would hand
 * back `undefined` for it and the dispatch would fail confusingly further down;
 * `unfireableRows` reports it as `socket_not_on_device` so an operator sees it instead.
 *
 * @param {Array} rows
 * @param {Date}  now
 * @param {{dispatchableDeviceIds: string[], deviceById: Map<string, object>}} opts
 * @returns {Array} sorted by `(device_id, socket)`, so audit rows land in a stable order
 */
export function resolveDue(rows, now, { dispatchableDeviceIds, deviceById }) {
  const byId = deviceById instanceof Map ? deviceById : new Map(Object.entries(deviceById ?? {}));
  const matched = dueCommands(rows, now, { dispatchableDeviceIds });

  const expanded = [];
  for (const cmd of matched) {
    const device = byId.get(cmd.device_id);
    if (!socketExistsOn(device, cmd.socket)) continue;
    for (const one of fanOutCommand(cmd, device)) expanded.push(one);
  }

  const collapsed = new Map();
  for (const cmd of expanded) {
    const key = targetKey(cmd);
    const held = collapsed.get(key);
    // First one wins unless this one is `off`, which always does. Two offs or two ons from
    // different rules are the same command twice; keeping either is correct, and keeping the
    // first keeps the result stable across calls.
    if (!held || (held.action !== 'off' && cmd.action === 'off')) collapsed.set(key, cmd);
  }

  return [...collapsed.values()].sort(
    (a, b) => a.device_id.localeCompare(b.device_id) || (a.socket ?? 0) - (b.socket ?? 0),
  );
}

/**
 * Rows that are armed but can never fire, and why.
 *
 * WHY THIS EXISTS, AND WHY IT IS NEW. Every one of these skips has always been in
 * `dueCommands`, and every one was survivable while a device held ONE row: an unattributed
 * schedule meant a whole device went quiet, and somebody noticed. In a stack of five it is one
 * rule going quiet, which nobody does. The daemon logs this count at every refresh so the
 * failure has a voice, and the Automation page renders the same reasons per rule.
 *
 * THE RULES THEMSELVES LIVE IN `shared/scheduleRules.mjs`, imported by both this daemon and the
 * browser. This project's older precedent — `src/lib/shedTiers.ts` mirroring
 * `server/shedPlan.mjs` — accepts two copies and tests them against each other; `shared/` is
 * how that cost is avoided, and there was no reason to pay it a second time. This function is
 * now only the row adapter and the shape the daemon logs.
 *
 * @returns {Array} `{id, device_id, socket, reason}` — one entry per row, first reason only
 */
export function unfireableRows(rows, { deviceById, dispatchableDeviceIds }) {
  const byId = deviceById instanceof Map ? deviceById : new Map(Object.entries(deviceById ?? {}));
  const dispatchable = new Set(dispatchableDeviceIds ?? []);
  const out = [];

  for (const row of rows ?? []) {
    const reason = scheduleProblem(ruleFromRow(row), byId.get(row?.device_id), dispatchable);
    if (reason) out.push({ id: row.id ?? null, device_id: row.device_id, socket: row.socket ?? null, reason });
  }
  return out;
}

export { UNFIREABLE_REASONS };
