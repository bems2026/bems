/**
 * Pure scheduling maths: given the `schedules` rows and the current time, which commands are
 * due right now. No I/O, so the part most likely to be subtly wrong is also the part that is
 * exhaustively unit-testable — see schedulePlan.test.mjs.
 *
 * The app and the flow disagree about how a week is numbered, and that disagreement is the
 * single most dangerous detail here: the Automation page stores `days` as 7 characters
 * Mon..Sun (index 0 is Monday), while JavaScript's `Date.getDay()` returns 0 for Sunday. A
 * schedule read with the wrong convention still looks completely healthy and simply switches
 * the office lights on the wrong day. `appDayIndex` is the single place that conversion
 * happens, and it is a rotation, not an offset.
 */

/** JS `getDay()` (0 = Sunday) -> the app's `days` string index (0 = Monday). */
export function appDayIndex(date) {
  return (date.getDay() + 6) % 7;
}

/** Mirrors `automationMath.parseDays` exactly: an unset or malformed value is all-false, NOT
 * a fabricated every-day default. A schedule nobody finished configuring must never fire. */
function parseDays(raw) {
  if (typeof raw !== 'string' || raw.length !== 7) return new Array(7).fill(false);
  return raw.split('').map((c) => c === '1');
}

const hhmm = (date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

/**
 * @param {Array} rows      `schedules` rows: {device_id, socket, rule:{on,off,days}, enabled, updated_by}
 * @param {Date}  now       evaluated to the minute, in the Pi's local time — schedules are
 *                          written by people looking at a wall clock, not at UTC
 * @param {{dispatchableDeviceIds: string[]}} opts
 *        Only these devices produce commands. Outlets and the ACU have no real dispatch path
 *        yet, and their schedules are still run by Node-RED's own cron; emitting commands for
 *        them would write `dry_run` audit rows for switching that genuinely happened, which is
 *        worse than not recording it at all.
 * @returns {Array} `{device_id, socket, action, requested_by, source}`
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
    });
  }
  return out;
}
