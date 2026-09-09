/**
 * Closed-loop aircon control: given the rules, the live readings and the persisted controller
 * state, which setpoint commands are due right now — and for every rule that produces none, WHY.
 *
 * Pure. No I/O, no clock, no registry lookup beyond what is passed in, so the part that decides
 * to move a compressor is the part that is exhaustively unit-testable with no hardware. Same
 * split `shedPlan.mjs` draws: this decides, `server/scheduler.mjs`'s `acuTick` fetches and fires.
 *
 * `holds` IS OUTPUT, NOT DIAGNOSTICS. A loop that does nothing must say so in a form a screen
 * can render, or "the rule is configured and nothing is happening" is indistinguishable from a
 * bug. On this site today it is the ONLY output — `acu_main` and `sens_outside_temp` have never
 * been paired (RM-016), so every rule holds on `acu_offline` until they are.
 *
 * ============================================================================
 * THE SAFETY POSTURE, which is the aircon equivalent of "auto-shed sheds, it never restores":
 *
 *   THE LOOP MAY CHANGE HOW COLD A RUNNING AIRCON IS ASKED TO BE.
 *   IT MAY NEVER CHANGE WHETHER THE BUILDING IS BEING COOLED.
 *
 * Losing the loop leaves the unit running at whatever setpoint it was last given — comfortable
 * or not, but running. A runaway loop cannot leave the building without cooling and cannot
 * switch anything on. That asymmetry is why the design is setpoint-only, and every guard below
 * exists to keep it true:
 *
 *   - no branch emits `action: 'off'`, and none acts unless the unit reports `state === 'on'`;
 *   - one step per `min_step_interval_s`, measured against PERSISTED state so a restart cannot
 *     re-arm the limiter (see `acu_loop_state` — this is why it is a table and not a variable);
 *   - no direction reversal within two intervals, because the ±0.5 deadband makes the hold band
 *     exactly one step wide, which is precisely the width that can hunt;
 *   - a human or a schedule wins, two ways: an observed setpoint that is not the one we
 *     commanded is ADOPTED as the new base, and any recent non-loop command suppresses a step.
 *     The second must cover `schedule` and `dsm_autoshed`, not just the app: sending "set 23" to
 *     a unit a schedule has just switched off will, on many IR libraries, turn it back on.
 * ============================================================================
 */

import { appDayIndex, parseDays, minutesOfDay } from '../shared/scheduleDays.mjs';
import { ACU_MIN_C, ACU_MAX_C } from '../shared/commands.mjs';
import { roomTargetFloorC } from '../shared/sitePolicy.mjs';
import { readTemperature, temperatureFieldFor } from '../shared/temperatureSources.mjs';

/**
 * The reason and alert vocabularies live in `shared/acuLoopVocabulary.mjs`, imported by this
 * daemon and by the Automation page alike, and re-exported here so a caller reading the planner
 * finds its own surface. A reason this can emit that the page has no sentence for would reach an
 * operator as a raw enum, and `test/acu-vocabulary.test.mjs` is what stops that.
 */
export { HOLD_REASONS, ALERT_KINDS } from '../shared/acuLoopVocabulary.mjs';

const hold = (rule, reason, detail) => ({ rule_id: rule.id, device_id: rule.acu_device_id, reason, detail: detail ?? null });

/** Whether `now` falls inside the rule's active window, in local wall-clock time. */
function windowState(rule, now) {
  const days = parseDays(rule.days);
  const start = minutesOfDay(rule.window_start);
  const end = minutesOfDay(rule.window_end);
  // A window is NEVER treated as wrapping midnight. `22:00 -> 06:00` is reported as invalid
  // rather than silently spanned: guessing which of the two readings an operator meant is how a
  // controller ends up running all night on a rule that looks like an evening one.
  if (start === null || end === null || end <= start) return 'invalid';
  if (!days.some(Boolean)) return 'invalid';
  if (!days[appDayIndex(now)]) return 'outside';
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin >= start && nowMin < end ? 'inside' : 'outside';
}

/**
 * @param {object} args
 * @param {Array}  args.rules       `acu_rules` rows, ALL of them — a disabled rule reports why
 * @param {Record<string, object>} args.readings   device_id -> the bridge's latest reading
 * @param {Date}   args.now         local time; the window is wall-clock, like schedules
 * @param {Record<string, object>} args.state      rule_id -> persisted `acu_loop_state`
 * @param {object} args.policy      the live merged site policy
 * @param {Map<string, object>|object} args.deviceById   registry entries
 * @param {string[]} args.dispatchableDeviceIds
 * @param {Record<string, {source: string, requested_at: string}>} [args.recentCommands]
 *        newest command per ACU device, whatever its source — the manual/schedule hold
 * @param {number} [args.maxReadingAgeMs=300000]
 * @returns {{actions: Array, holds: Array, alerts: Array}}
 */
export function planSetpoint({ rules, readings, now, state, policy, deviceById, dispatchableDeviceIds, recentCommands, maxReadingAgeMs = 300_000 }) {
  const byId = deviceById instanceof Map ? deviceById : new Map(Object.entries(deviceById ?? {}));
  const dispatchable = new Set(dispatchableDeviceIds ?? []);
  const floor = roomTargetFloorC(policy);

  const actions = [];
  const holds = [];
  const alerts = [];

  for (const rule of rules ?? []) {
    const st = state?.[rule.id] ?? {};
    const decision = decide(rule, { byId, readings, now, st, floor, dispatchable, recentCommands, maxReadingAgeMs });

    if (decision.action) actions.push(decision.action);
    else holds.push(hold(rule, decision.reason, decision.detail));

    // EDGE-TRIGGERED, by comparing the computed kind against the stored one. A level-triggered
    // condition would re-notify every tick until somebody muted it, which is how alerting gets
    // switched off entirely. Same state machine `server/fleetAlarm.mjs` uses.
    const was = st.alert_kind ?? null;
    const is = decision.alert ?? null;
    if (is !== was) {
      if (is) alerts.push({ rule_id: rule.id, kind: is, transition: 'raised', message: decision.alertMessage ?? is });
      else alerts.push({ rule_id: rule.id, kind: was, transition: 'cleared', message: `${was} cleared` });
    }
  }

  return { actions, holds, alerts };
}

/** One rule's decision. Branches are ordered; the first that matches wins. */
function decide(rule, ctx) {
  const { byId, readings, now, st, floor, dispatchable, recentCommands, maxReadingAgeMs } = ctx;

  if (!rule.enabled) return { reason: 'rule_disabled' };

  const acu = byId.get(rule.acu_device_id);
  const sensor = byId.get(rule.sensor_device_id);
  if (!acu) return { reason: 'unknown_acu_device', detail: rule.acu_device_id };
  if (!sensor) return { reason: 'unknown_sensor_device', detail: rule.sensor_device_id };
  if (acu.class !== 'acu_ir') return { reason: 'acu_device_wrong_class', detail: acu.class };
  if (temperatureFieldFor(sensor) === null) return { reason: 'sensor_has_no_temperature_field', detail: sensor.class };

  const win = windowState(rule, now);
  if (win === 'invalid') return { reason: 'invalid_window', detail: `${rule.window_start}-${rule.window_end} on "${rule.days}"` };
  if (win === 'outside') return { reason: 'outside_window' };

  if (!dispatchable.has(rule.acu_device_id)) return { reason: 'acu_not_dispatchable' };

  /**
   * A target below the site's policy without a written reason.
   *
   * `upsert_acu_rule` should have prevented this, so reaching it means the row was written by
   * the service role or predates a policy tightening. Refused AND alerted rather than quietly
   * clamped: clamping would run a rule the operator never agreed to.
   */
  if (floor !== null && Number(rule.target_c) < floor && !rule.override_reason) {
    return {
      reason: 'target_below_policy_unauthorised',
      detail: `target ${rule.target_c}°C is below the ${floor}°C room-comfort policy and carries no recorded reason`,
      alert: 'target_below_policy',
      alertMessage: `Rule ${rule.id} aims at ${rule.target_c}°C, below this building's ${floor}°C policy, with no recorded reason. It is not running.`,
    };
  }

  const acuReading = readings?.[rule.acu_device_id];
  if (!acuReading) return { reason: 'acu_reading_missing' };
  if (acuReading.online === false) return { reason: 'acu_offline' };
  // SETPOINT ONLY. The loop never powers a unit on, so an aircon that is off is simply not
  // something it has anything to say about.
  if (acuReading.state !== 'on') return { reason: 'acu_off' };

  const temp = readTemperature(sensor, readings?.[rule.sensor_device_id], { now, maxAgeMs: maxReadingAgeMs });
  if (!temp.ok) {
    return {
      reason: 'sensor_unavailable',
      detail: temp.reason === 'stale' ? `last reading is ${Math.round((temp.ageMs ?? 0) / 1000)}s old` : temp.reason,
      alert: 'sensor_unavailable',
      alertMessage: `Rule ${rule.id} cannot read ${rule.sensor_device_id}: ${temp.reason}.`,
    };
  }

  /**
   * Somebody else moved the setpoint.
   *
   * Checked BEFORE the rate limit, because adopting the observed value is the response — not
   * stepping from a base that is no longer true. This catches the physical remote, which writes
   * no `commands` row at all. It requires `setpoint_c` on the reading, which is absent while the
   * blaster is unpaired, so on this site today it does nothing.
   */
  const observed = typeof acuReading.setpoint_c === 'number' ? Math.round(acuReading.setpoint_c) : null;
  const commanded = typeof st.commanded_c === 'number' ? st.commanded_c : null;
  if (observed !== null && commanded !== null && observed !== commanded) {
    return { reason: 'setpoint_changed_externally', detail: `observed ${observed}°C, we last commanded ${commanded}°C — adopting`, adopt: observed };
  }

  // The audit-based half of the same guard, and the only half that works today. It must cover
  // EVERY non-loop source: a "set 23" sent seconds after a schedule switched the unit off can
  // turn it back on.
  const recent = recentCommands?.[rule.acu_device_id];
  if (recent && recent.source !== 'acu_loop') {
    const ageS = (now.getTime() - Date.parse(recent.requested_at)) / 1000;
    if (Number.isFinite(ageS) && ageS >= 0 && ageS < Number(rule.manual_hold_s)) {
      return { reason: 'manual_override_recent', detail: `${recent.source} commanded this unit ${Math.round(ageS)}s ago` };
    }
  }

  const base = commanded ?? observed;
  // Never `acuMode`'s fallback of 25. Inventing a base is inventing a command, and the first
  // step from a fabricated base moves the room in a direction nobody chose.
  if (base === null) return { reason: 'no_commanded_setpoint' };

  // A step that was not recorded is a step that will be repeated after the next restart.
  if (st.writable === false) return { reason: 'state_unwritable' };

  const target = Number(rule.target_c);
  const deadband = Number(rule.deadband_c);
  const step = Number(rule.step_c);
  const error = temp.value - target;

  if (Math.abs(error) <= deadband) return { reason: 'at_target', detail: `${temp.value}°C vs ${target}°C` };

  const direction = error > 0 ? 'down' : 'up';

  if (direction === 'down' && base <= ACU_MIN_C) {
    return {
      reason: 'at_hardware_floor',
      detail: `holding at ${ACU_MIN_C}°C; the room is ${temp.value}°C against a ${target}°C target`,
      alert: 'floor_reached',
      alertMessage: `Rule ${rule.id} is at the ${ACU_MIN_C}°C floor and the room is still ${temp.value}°C against a ${target}°C target.`,
    };
  }
  if (direction === 'up' && base >= ACU_MAX_C) {
    return {
      reason: 'at_hardware_ceiling',
      detail: `holding at ${ACU_MAX_C}°C; the room is ${temp.value}°C against a ${target}°C target`,
      alert: 'ceiling_reached',
      alertMessage: `Rule ${rule.id} is at the ${ACU_MAX_C}°C ceiling and the room is still ${temp.value}°C against a ${target}°C target.`,
    };
  }

  const sinceStepS = st.last_step_at ? (now.getTime() - Date.parse(st.last_step_at)) / 1000 : Infinity;
  if (Number.isFinite(sinceStepS) && sinceStepS < Number(rule.min_step_interval_s)) {
    return { reason: 'rate_limited', detail: `${Math.round(sinceStepS)}s since the last step, interval is ${rule.min_step_interval_s}s` };
  }

  /**
   * ANTI-HUNT. The ±0.5 deadband makes the hold band exactly 1.0 °C wide — exactly one step —
   * which is the width that can oscillate: target+0.6 steps down, the room overshoots to
   * target−0.6, and it steps straight back up. Requiring two full intervals before reversing
   * costs one state column and is testable with no hardware.
   */
  if (st.last_direction && st.last_direction !== direction && Number.isFinite(sinceStepS) && sinceStepS < 2 * Number(rule.min_step_interval_s)) {
    return { reason: 'reverse_suppressed', detail: `last step was ${st.last_direction} ${Math.round(sinceStepS)}s ago` };
  }

  const to = direction === 'down' ? Math.max(ACU_MIN_C, base - step) : Math.min(ACU_MAX_C, base + step);
  if (to === base) return { reason: direction === 'down' ? 'at_hardware_floor' : 'at_hardware_ceiling' };

  return {
    action: {
      rule_id: rule.id,
      device_id: rule.acu_device_id,
      socket: null,
      action: 'on',
      target_c: to,
      from_c: base,
      room_c: temp.value,
      direction,
      requested_by: rule.updated_by,
      source: 'acu_loop',
    },
  };
}
