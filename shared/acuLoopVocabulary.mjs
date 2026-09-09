/**
 * Every reason the aircon controller can be idle, every alert it can raise, and the sentence
 * for each — ONE definition, imported by both halves.
 *
 * WHY IT IS HERE AND NOT IN THE PLANNER. `server/acuLoopPlan.mjs` decides these; the daemon
 * logs the code and the Automation page renders the prose, which are different jobs. What must
 * not differ is the SET: a reason the planner can emit and the page has no text for reaches an
 * operator as a raw enum. Putting the vocabulary in `shared/` is how this repo already stops
 * that class of drift — see `shared/scheduleRules.mjs`, which does the same for schedules — and
 * it avoids the browser importing from `server/`, which has no path alias and should not gain
 * one.
 *
 * The wording is deliberately specific about what to DO. `acu_offline` as a sentence is not
 * "something is wrong with the aircon"; it is "this device has never been paired, and pairing it
 * is what makes this rule start working" — because the person reading that sentence is the one
 * who can arrange it.
 */

/** Every reason `planSetpoint` can report instead of an action. */
export const HOLD_REASONS = Object.freeze([
  'rule_disabled',
  'unknown_acu_device',
  'unknown_sensor_device',
  'acu_device_wrong_class',
  'sensor_has_no_temperature_field',
  'invalid_window',
  'outside_window',
  'acu_not_dispatchable',
  'target_below_policy_unauthorised',
  'acu_reading_missing',
  'acu_offline',
  'acu_off',
  'sensor_unavailable',
  'manual_override_recent',
  'setpoint_changed_externally',
  'no_commanded_setpoint',
  'state_unwritable',
  'rate_limited',
  'reverse_suppressed',
  'at_target',
  'at_hardware_floor',
  'at_hardware_ceiling',
]);

/** The alert kinds it can raise. Edge-triggered — see `planSetpoint`. */
export const ALERT_KINDS = Object.freeze(['floor_reached', 'ceiling_reached', 'sensor_unavailable', 'target_below_policy']);

/** A sentence for every code above. `test/acu-vocabulary.test.mjs` holds this complete. */
export const ACU_TEXT = Object.freeze({
  rule_disabled: 'Disarmed — the controller ignores this rule.',
  unknown_acu_device: 'The aircon named by this rule is not in the device registry.',
  unknown_sensor_device: 'The sensor named by this rule is not in the device registry.',
  acu_device_wrong_class: 'The device named here is not an IR-commandable aircon, so it has no setpoint to move.',
  sensor_has_no_temperature_field: 'The device named as the sensor does not report a temperature.',
  invalid_window: 'The active window is not usable — check the days, and that the end time is after the start. A window is never treated as running past midnight.',
  outside_window: 'Outside its active window, so the controller is deliberately not adjusting anything.',
  acu_not_dispatchable: 'Hardware dispatch is closed for aircon commands on this deployment, so a step would be recorded and nothing would move.',
  target_below_policy_unauthorised: 'The target is below the building’s room-comfort policy and carries no recorded reason, so the rule is not running.',
  acu_reading_missing: 'No reading has arrived for this aircon at all.',
  acu_offline: 'The aircon reports offline. On this site the IR blaster has never been paired to the vendor account — pairing it is what makes this rule start working.',
  acu_off: 'The aircon is switched off. The controller only ever adjusts a running unit; it never powers one on.',
  sensor_unavailable: 'The sensor has no usable reading — offline, absent, or too old to act on. The controller will not move a compressor on a guess.',
  manual_override_recent: 'Somebody, or another rule, commanded this unit recently. The controller is standing back.',
  setpoint_changed_externally: 'The unit’s setpoint was changed by something other than this rule. The controller has adopted the new value and will step from there.',
  no_commanded_setpoint: 'The controller does not know what setpoint the unit is on, and will not invent one to step from.',
  state_unwritable: 'The last step could not be recorded. The rule is holding rather than risk repeating it after a restart.',
  rate_limited: 'Waiting out the interval since the last step. A room takes minutes to respond, and stepping faster overshoots.',
  reverse_suppressed: 'It stepped the other way recently. Reversing this soon is how a controller starts hunting instead of settling.',
  at_target: 'The room is at its target.',
  at_hardware_floor: 'Holding at 16 °C, the coldest the aircon can be told, and the room is still above its target.',
  at_hardware_ceiling: 'Holding at 30 °C, the warmest the aircon can be told, and the room is still below its target.',

  // Alert kinds. Shorter, because they render beside a timestamp.
  floor_reached: 'Stuck at the 16 °C floor — the room will not come down to target',
  ceiling_reached: 'Stuck at the 30 °C ceiling — the room will not come up to target',
  target_below_policy: 'Target below the building’s room-comfort policy, with no recorded reason',
});
