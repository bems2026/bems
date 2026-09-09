/**
 * The closed-loop aircon controller — RM-069.
 *
 * Every branch is pinned here because none of it can be exercised on this site's hardware:
 * `acu_main` and `sens_outside_temp` have never been paired (RM-016), so a live rule holds on
 * `acu_offline` and nothing else. That makes this file the only place the logic is proven, and
 * the room-model test at the end is the only oscillation evidence that exists.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { planSetpoint, HOLD_REASONS, ALERT_KINDS } from './acuLoopPlan.mjs';

const USER = '33333333-3333-3333-3333-333333333333';

const DEVICES = new Map([
  ['acu_main', { id: 'acu_main', class: 'acu_ir', measures: 'return_air' }],
  ['acu_two', { id: 'acu_two', class: 'acu_ir' }],
  ['sens_room', { id: 'sens_room', class: 'sensor_temp_humidity', measures: 'room_air' }],
  ['l1', { id: 'l1', class: 'switch' }],
  ['mtr', { id: 'mtr', class: 'meter' }],
]);

// 2026-08-24 is a Monday. 10:00 is inside a Mon–Fri 08:00–17:00 window.
const MON_10 = new Date('2026-08-24T10:00:00');

const rule = (over = {}) => ({
  id: 'r1',
  acu_device_id: 'acu_main',
  sensor_device_id: 'sens_room',
  target_c: 24,
  deadband_c: 0.5,
  step_c: 1,
  min_step_interval_s: 600,
  manual_hold_s: 600,
  days: '1111100',
  window_start: '08:00',
  window_end: '17:00',
  enabled: true,
  override_reason: null,
  updated_by: USER,
  ...over,
});

const acuOn = (setpoint = 25) => ({ device_id: 'acu_main', ts: MON_10.toISOString(), online: true, state: 'on', setpoint_c: setpoint });
const roomAt = (c, at = MON_10) => ({ device_id: 'sens_room', ts: at.toISOString(), online: true, temp_c: c });

const plan = (over = {}) =>
  planSetpoint({
    rules: [rule()],
    readings: { acu_main: acuOn(), sens_room: roomAt(24) },
    now: MON_10,
    state: { r1: { commanded_c: 25, last_step_at: null, last_direction: null, alert_kind: null } },
    policy: { acu_min_room_target_c: 24 },
    deviceById: DEVICES,
    dispatchableDeviceIds: ['acu_main', 'acu_two'],
    recentCommands: {},
    ...over,
  });

const reasonOf = (p) => p.holds[0]?.reason ?? null;

/* --------------------------------------------------------------------------
 * The two directions, and the deadband between them
 * ----------------------------------------------------------------------- */

test('room ABOVE target steps the setpoint DOWN by one degree', () => {
  const p = plan({ readings: { acu_main: acuOn(25), sens_room: roomAt(26) } });
  assert.equal(p.holds.length, 0);
  assert.equal(p.actions.length, 1);
  assert.deepEqual(
    { to: p.actions[0].target_c, from: p.actions[0].from_c, dir: p.actions[0].direction, action: p.actions[0].action },
    { to: 24, from: 25, dir: 'down', action: 'on' },
  );
});

test('room BELOW target steps the setpoint UP by one degree', () => {
  const p = plan({ readings: { acu_main: acuOn(25), sens_room: roomAt(22.5) } });
  assert.equal(p.actions[0].target_c, 26);
  assert.equal(p.actions[0].direction, 'up');
});

test('within the deadband it HOLDS, and says it reached the target', () => {
  for (const room of [23.6, 24, 24.4, 24.5, 23.5]) {
    const p = plan({ readings: { acu_main: acuOn(25), sens_room: roomAt(room) } });
    assert.equal(reasonOf(p), 'at_target', `room ${room}`);
    assert.equal(p.actions.length, 0);
  }
});

test('the deadband is inclusive at exactly ±0.5, and 0.6 is outside it', () => {
  assert.equal(reasonOf(plan({ readings: { acu_main: acuOn(25), sens_room: roomAt(24.5) } })), 'at_target');
  assert.equal(plan({ readings: { acu_main: acuOn(25), sens_room: roomAt(24.6) } }).actions.length, 1);
});

test('the command carries what it saw, so an audit row can be read without the reading', () => {
  const p = plan({ readings: { acu_main: acuOn(25), sens_room: roomAt(27.2) } });
  assert.deepEqual(
    { room: p.actions[0].room_c, by: p.actions[0].requested_by, src: p.actions[0].source, socket: p.actions[0].socket },
    { room: 27.2, by: USER, src: 'acu_loop', socket: null },
  );
});

/* --------------------------------------------------------------------------
 * The safety posture
 * ----------------------------------------------------------------------- */

test('NO branch ever emits an off — the loop may not stop the building being cooled', () => {
  // The aircon equivalent of "auto-shed sheds, it never restores".
  const rooms = [10, 16, 20, 23.9, 24, 24.1, 28, 35];
  for (const room of rooms) {
    for (const commanded of [16, 20, 25, 30]) {
      const p = plan({
        readings: { acu_main: acuOn(commanded), sens_room: roomAt(room) },
        state: { r1: { commanded_c: commanded } },
      });
      assert.ok(p.actions.every((a) => a.action === 'on'), `room ${room} at ${commanded}`);
    }
  }
});

test('an aircon that is OFF is left alone — the loop never powers a unit on', () => {
  const p = plan({ readings: { acu_main: { ...acuOn(25), state: 'off' }, sens_room: roomAt(30) } });
  assert.equal(reasonOf(p), 'acu_off');
  assert.equal(p.actions.length, 0);
});

test('an OFFLINE aircon is left alone — today this is the only branch this site reaches', () => {
  const p = plan({ readings: { acu_main: { ...acuOn(25), online: false }, sens_room: roomAt(30) } });
  assert.equal(reasonOf(p), 'acu_offline');
});

test('a missing aircon reading is distinct from an offline one', () => {
  assert.equal(reasonOf(plan({ readings: { sens_room: roomAt(30) } })), 'acu_reading_missing');
});

test('the rate limit holds a second step inside the interval', () => {
  const p = plan({
    readings: { acu_main: acuOn(25), sens_room: roomAt(28) },
    state: { r1: { commanded_c: 25, last_step_at: new Date(MON_10.getTime() - 60_000).toISOString() } },
  });
  assert.equal(reasonOf(p), 'rate_limited');
});

test('a step is allowed once the interval has elapsed', () => {
  const p = plan({
    readings: { acu_main: acuOn(25), sens_room: roomAt(28) },
    state: { r1: { commanded_c: 25, last_step_at: new Date(MON_10.getTime() - 601_000).toISOString() } },
  });
  assert.equal(p.actions.length, 1);
});

test('a REVERSAL is suppressed within two intervals — the anti-hunt guard', () => {
  const p = plan({
    readings: { acu_main: acuOn(25), sens_room: roomAt(22) },
    state: { r1: { commanded_c: 25, last_step_at: new Date(MON_10.getTime() - 700_000).toISOString(), last_direction: 'down' } },
  });
  assert.equal(reasonOf(p), 'reverse_suppressed');
});

test('the SAME direction is not suppressed — only a reversal is', () => {
  const p = plan({
    readings: { acu_main: acuOn(25), sens_room: roomAt(28) },
    state: { r1: { commanded_c: 25, last_step_at: new Date(MON_10.getTime() - 700_000).toISOString(), last_direction: 'down' } },
  });
  assert.equal(p.actions.length, 1);
  assert.equal(p.actions[0].direction, 'down');
});

test('a reversal after two full intervals is allowed', () => {
  const p = plan({
    readings: { acu_main: acuOn(25), sens_room: roomAt(22) },
    state: { r1: { commanded_c: 25, last_step_at: new Date(MON_10.getTime() - 1_300_000).toISOString(), last_direction: 'down' } },
  });
  assert.equal(p.actions[0].direction, 'up');
});

test('a recent command from a HUMAN suppresses the loop', () => {
  const p = plan({
    readings: { acu_main: acuOn(25), sens_room: roomAt(28) },
    recentCommands: { acu_main: { source: 'ibems-app', requested_at: new Date(MON_10.getTime() - 60_000).toISOString() } },
  });
  assert.equal(reasonOf(p), 'manual_override_recent');
});

test('a recent SCHEDULE command suppresses it too — the branch that stops it re-powering a unit', () => {
  // Sending "set 23" seconds after a schedule switched the unit off will, on many IR libraries,
  // turn it back on. Covering only `ibems-app` here would leave that open.
  for (const source of ['schedule', 'dsm_autoshed']) {
    const p = plan({
      readings: { acu_main: acuOn(25), sens_room: roomAt(28) },
      recentCommands: { acu_main: { source, requested_at: new Date(MON_10.getTime() - 30_000).toISOString() } },
    });
    assert.equal(reasonOf(p), 'manual_override_recent', source);
  }
});

test('the loop does not suppress itself', () => {
  const p = plan({
    readings: { acu_main: acuOn(25), sens_room: roomAt(28) },
    recentCommands: { acu_main: { source: 'acu_loop', requested_at: new Date(MON_10.getTime() - 30_000).toISOString() } },
  });
  assert.equal(p.actions.length, 1);
});

test('a hold expires once manual_hold_s has passed', () => {
  const p = plan({
    readings: { acu_main: acuOn(25), sens_room: roomAt(28) },
    recentCommands: { acu_main: { source: 'ibems-app', requested_at: new Date(MON_10.getTime() - 700_000).toISOString() } },
  });
  assert.equal(p.actions.length, 1);
});

test('an externally changed setpoint is ADOPTED, not stepped from', () => {
  const p = plan({
    readings: { acu_main: acuOn(20), sens_room: roomAt(28) },
    state: { r1: { commanded_c: 25 } },
  });
  assert.equal(reasonOf(p), 'setpoint_changed_externally');
  assert.equal(p.holds[0].detail.includes('20'), true);
});

test('no known base setpoint means no command — a fabricated base is a fabricated command', () => {
  const p = plan({
    readings: { acu_main: { device_id: 'acu_main', ts: MON_10.toISOString(), online: true, state: 'on' }, sens_room: roomAt(28) },
    state: { r1: {} },
  });
  assert.equal(reasonOf(p), 'no_commanded_setpoint');
});

test('an unwritable state holds, so a step cannot be silently repeated after a restart', () => {
  const p = plan({
    readings: { acu_main: acuOn(25), sens_room: roomAt(28) },
    state: { r1: { commanded_c: 25, writable: false } },
  });
  assert.equal(reasonOf(p), 'state_unwritable');
});

/* --------------------------------------------------------------------------
 * Bounds and alerts
 * ----------------------------------------------------------------------- */

test('at the 16°C floor with the room still hot it HOLDS and raises an alert', () => {
  const p = plan({
    readings: { acu_main: acuOn(16), sens_room: roomAt(28) },
    state: { r1: { commanded_c: 16, alert_kind: null } },
  });
  assert.equal(reasonOf(p), 'at_hardware_floor');
  assert.equal(p.actions.length, 0);
  assert.deepEqual(p.alerts.map((a) => [a.kind, a.transition]), [['floor_reached', 'raised']]);
});

test('a step never goes below 16 or above 30', () => {
  const low = plan({ readings: { acu_main: acuOn(17), sens_room: roomAt(30) }, state: { r1: { commanded_c: 17 } } });
  assert.equal(low.actions[0].target_c, 16);
  const high = plan({ readings: { acu_main: acuOn(29), sens_room: roomAt(20) }, state: { r1: { commanded_c: 29 } } });
  assert.equal(high.actions[0].target_c, 30);
});

test('at the 30°C ceiling with the room still cold it holds and alerts', () => {
  const p = plan({ readings: { acu_main: acuOn(30), sens_room: roomAt(20) }, state: { r1: { commanded_c: 30 } } });
  assert.equal(reasonOf(p), 'at_hardware_ceiling');
  assert.equal(p.alerts[0].kind, 'ceiling_reached');
});

test('alerts are EDGE-triggered — a standing condition does not re-notify every tick', () => {
  const p = plan({
    readings: { acu_main: acuOn(16), sens_room: roomAt(28) },
    state: { r1: { commanded_c: 16, alert_kind: 'floor_reached' } },
  });
  assert.equal(reasonOf(p), 'at_hardware_floor');
  assert.deepEqual(p.alerts, [], 'already raised, so nothing new to say');
});

test('an alert CLEARS when the condition goes away', () => {
  const p = plan({
    readings: { acu_main: acuOn(25), sens_room: roomAt(24) },
    state: { r1: { commanded_c: 25, alert_kind: 'floor_reached' } },
  });
  assert.deepEqual(p.alerts.map((a) => [a.kind, a.transition]), [['floor_reached', 'cleared']]);
});

/* --------------------------------------------------------------------------
 * Configuration faults
 * ----------------------------------------------------------------------- */

test('a disabled rule reports why rather than vanishing', () => {
  assert.equal(reasonOf(plan({ rules: [rule({ enabled: false })] })), 'rule_disabled');
});

test('unknown or wrong-class devices are reported distinctly', () => {
  assert.equal(reasonOf(plan({ rules: [rule({ acu_device_id: 'ghost' })] })), 'unknown_acu_device');
  assert.equal(reasonOf(plan({ rules: [rule({ sensor_device_id: 'ghost' })] })), 'unknown_sensor_device');
  assert.equal(reasonOf(plan({ rules: [rule({ acu_device_id: 'l1' })] })), 'acu_device_wrong_class');
  assert.equal(reasonOf(plan({ rules: [rule({ sensor_device_id: 'mtr' })] })), 'sensor_has_no_temperature_field');
});

test('a window that would wrap midnight is REPORTED, never silently spanned', () => {
  // Guessing which reading an operator meant is how a controller ends up running all night on a
  // rule that reads like an evening one.
  assert.equal(reasonOf(plan({ rules: [rule({ window_start: '22:00', window_end: '06:00' })] })), 'invalid_window');
  assert.equal(reasonOf(plan({ rules: [rule({ window_start: '08:00', window_end: '08:00' })] })), 'invalid_window');
  assert.equal(reasonOf(plan({ rules: [rule({ days: '0000000' })] })), 'invalid_window');
  assert.equal(reasonOf(plan({ rules: [rule({ window_start: 'nope' })] })), 'invalid_window');
});

test('outside the active window it does nothing, on the clock and on the day', () => {
  assert.equal(reasonOf(plan({ now: new Date('2026-08-24T07:59:00') })), 'outside_window');
  assert.equal(reasonOf(plan({ now: new Date('2026-08-24T17:00:00') })), 'outside_window', 'the end is exclusive');
  assert.equal(reasonOf(plan({ now: new Date('2026-08-23T10:00:00') })), 'outside_window', 'Sunday is not in Mon-Fri');
});

test('the window start is inclusive', () => {
  const p = plan({ now: new Date('2026-08-24T08:00:00'), readings: { acu_main: acuOn(25), sens_room: roomAt(28, new Date('2026-08-24T08:00:00')) } });
  assert.equal(p.actions.length, 1);
});

test('an aircon with no dispatch path is reported, not attempted', () => {
  assert.equal(reasonOf(plan({ dispatchableDeviceIds: [] })), 'acu_not_dispatchable');
});

test('a target below policy with NO recorded reason refuses and alerts', () => {
  const p = plan({ rules: [rule({ target_c: 20 })], policy: { acu_min_room_target_c: 24 } });
  assert.equal(reasonOf(p), 'target_below_policy_unauthorised');
  assert.equal(p.alerts[0].kind, 'target_below_policy');
});

test('a target below policy WITH a recorded reason runs', () => {
  const p = plan({
    rules: [rule({ target_c: 20, override_reason: 'Server rack in this room overheats above 21C; approved by the dean.' })],
    policy: { acu_min_room_target_c: 24 },
    readings: { acu_main: acuOn(25), sens_room: roomAt(28) },
  });
  assert.equal(p.actions.length, 1);
});

test('a site with no policy at all bounds nothing but the hardware', () => {
  const p = plan({ rules: [rule({ target_c: 18 })], policy: {}, readings: { acu_main: acuOn(25), sens_room: roomAt(28) } });
  assert.equal(p.actions.length, 1);
});

/* --------------------------------------------------------------------------
 * Sensor availability — distinct reasons, never a substituted value
 * ----------------------------------------------------------------------- */

test('an unavailable sensor holds and alerts, and says which kind of unavailable', () => {
  const cases = [
    [undefined, /no_reading/],
    [{ device_id: 'sens_room', ts: MON_10.toISOString(), online: false, temp_c: 25 }, /offline/],
    [{ device_id: 'sens_room', ts: MON_10.toISOString(), online: true }, /absent/],
    [{ device_id: 'sens_room', ts: new Date(MON_10.getTime() - 400_000).toISOString(), online: true, temp_c: 25 }, /old/],
  ];
  for (const [reading, detail] of cases) {
    const p = plan({ readings: { acu_main: acuOn(25), ...(reading ? { sens_room: reading } : {}) } });
    assert.equal(reasonOf(p), 'sensor_unavailable', String(detail));
    assert.match(p.holds[0].detail, detail);
    assert.equal(p.alerts[0]?.kind, 'sensor_unavailable');
  }
});

/* --------------------------------------------------------------------------
 * Shape
 * ----------------------------------------------------------------------- */

test('every rule produces exactly one action OR one hold, never both and never neither', () => {
  const rules = [rule({ id: 'a' }), rule({ id: 'b', enabled: false }), rule({ id: 'c', acu_device_id: 'ghost' })];
  const p = plan({ rules, readings: { acu_main: acuOn(25), sens_room: roomAt(28) } });
  assert.equal(p.actions.length + p.holds.length, rules.length);
  const ids = [...p.actions.map((a) => a.rule_id), ...p.holds.map((h) => h.rule_id)].sort();
  assert.deepEqual(ids, ['a', 'b', 'c']);
});

test('every reason it can emit is declared in HOLD_REASONS', () => {
  const seen = new Set();
  const variants = [
    plan({ rules: [rule({ enabled: false })] }),
    plan({ rules: [rule({ acu_device_id: 'ghost' })] }),
    plan({ rules: [rule({ sensor_device_id: 'ghost' })] }),
    plan({ rules: [rule({ acu_device_id: 'l1' })] }),
    plan({ rules: [rule({ sensor_device_id: 'mtr' })] }),
    plan({ rules: [rule({ window_start: '22:00', window_end: '06:00' })] }),
    plan({ now: new Date('2026-08-24T07:00:00') }),
    plan({ dispatchableDeviceIds: [] }),
    plan({ rules: [rule({ target_c: 20 })] }),
    plan({ readings: { sens_room: roomAt(28) } }),
    plan({ readings: { acu_main: { ...acuOn(25), online: false } } }),
    plan({ readings: { acu_main: { ...acuOn(25), state: 'off' } } }),
    plan({ readings: { acu_main: acuOn(25) } }),
    plan({ readings: { acu_main: acuOn(25), sens_room: roomAt(28) }, recentCommands: { acu_main: { source: 'ibems-app', requested_at: MON_10.toISOString() } } }),
    plan({ readings: { acu_main: acuOn(20), sens_room: roomAt(28) } }),
    plan({ readings: { acu_main: { device_id: 'acu_main', ts: MON_10.toISOString(), online: true, state: 'on' }, sens_room: roomAt(28) }, state: { r1: {} } }),
    plan({ readings: { acu_main: acuOn(25), sens_room: roomAt(28) }, state: { r1: { commanded_c: 25, writable: false } } }),
    plan({ readings: { acu_main: acuOn(25), sens_room: roomAt(28) }, state: { r1: { commanded_c: 25, last_step_at: MON_10.toISOString() } } }),
    plan({ readings: { acu_main: acuOn(25), sens_room: roomAt(22) }, state: { r1: { commanded_c: 25, last_step_at: new Date(MON_10.getTime() - 700_000).toISOString(), last_direction: 'down' } } }),
    plan(),
    plan({ readings: { acu_main: acuOn(16), sens_room: roomAt(28) }, state: { r1: { commanded_c: 16 } } }),
    plan({ readings: { acu_main: acuOn(30), sens_room: roomAt(20) }, state: { r1: { commanded_c: 30 } } }),
  ];
  for (const p of variants) for (const h of p.holds) seen.add(h.reason);
  for (const r of seen) assert.ok(HOLD_REASONS.includes(r), `${r} is not declared in HOLD_REASONS`);
  assert.equal(seen.size, HOLD_REASONS.length, `unreached: ${HOLD_REASONS.filter((r) => !seen.has(r)).join(', ')}`);
});

test('every alert kind it can emit is declared in ALERT_KINDS', () => {
  const seen = new Set();
  for (const p of [
    plan({ readings: { acu_main: acuOn(16), sens_room: roomAt(28) }, state: { r1: { commanded_c: 16 } } }),
    plan({ readings: { acu_main: acuOn(30), sens_room: roomAt(20) }, state: { r1: { commanded_c: 30 } } }),
    plan({ readings: { acu_main: acuOn(25) } }),
    plan({ rules: [rule({ target_c: 20 })] }),
  ]) for (const a of p.alerts) seen.add(a.kind);
  assert.deepEqual([...seen].sort(), [...ALERT_KINDS].sort());
});

/* --------------------------------------------------------------------------
 * THE OSCILLATION PROOF
 * ----------------------------------------------------------------------- */

test('driven against a first-order room for 200 ticks, the setpoint SETTLES rather than hunting', () => {
  /**
   * The only evidence that exists that this controller does not hunt, because the hardware to
   * try it on has never been paired. A first-order room: its temperature moves toward the
   * commanded setpoint by a fixed fraction of the gap each tick, plus a steady heat gain that
   * keeps it warmer than whatever it is asked for. Deliberately crude — the point is not to
   * model this building, it is to close the loop with SOMETHING that responds and confirm the
   * guards hold.
   */
  const TICK_MS = 60_000;
  const TAU = 0.12;      // fraction of the gap closed per minute
  const GAIN = 2.2;      // degrees of steady heat gain above the setpoint
  const START = new Date('2026-08-24T08:00:00');

  let room = 29;
  let commanded = 27;
  let st = { commanded_c: commanded, last_step_at: null, last_direction: null, alert_kind: null };
  const commandedHistory = [];

  for (let i = 0; i < 200; i++) {
    const now = new Date(START.getTime() + i * TICK_MS);
    // Keep the window open for the whole run.
    const r = rule({ window_start: '00:00', window_end: '23:59', days: '1111111' });
    const p = planSetpoint({
      rules: [r],
      readings: {
        acu_main: { device_id: 'acu_main', ts: now.toISOString(), online: true, state: 'on', setpoint_c: commanded },
        sens_room: { device_id: 'sens_room', ts: now.toISOString(), online: true, temp_c: Number(room.toFixed(2)) },
      },
      now,
      state: { r1: st },
      policy: { acu_min_room_target_c: 24 },
      deviceById: DEVICES,
      dispatchableDeviceIds: ['acu_main'],
      recentCommands: {},
    });

    if (p.actions.length > 0) {
      commanded = p.actions[0].target_c;
      st = { ...st, commanded_c: commanded, last_step_at: now.toISOString(), last_direction: p.actions[0].direction };
    }
    commandedHistory.push(commanded);

    // The room chases the setpoint plus its heat gain.
    room += TAU * (commanded + GAIN - room);
  }

  const settled = commandedHistory.slice(-40);
  const spread = Math.max(...settled) - Math.min(...settled);
  assert.ok(spread <= 1, `the setpoint must settle, not hunt — last 40 ticks spanned ${spread}°C: ${[...new Set(settled)].join(',')}`);

  // And it must have actually done its job: the room ends inside the deadband.
  assert.ok(Math.abs(room - 24) <= 0.5, `room settled at ${room.toFixed(2)}°C, outside the ±0.5 band around 24`);

  // Steps are rate-limited, so 200 minutes can hold at most ~20 of them.
  const steps = commandedHistory.filter((c, i) => i > 0 && c !== commandedHistory[i - 1]).length;
  assert.ok(steps <= 21, `rate limit must hold: ${steps} steps in 200 minutes`);
  assert.ok(steps >= 2, 'it must actually have moved, or this proves nothing');
});

test('a room that CANNOT be cooled to target walks to the floor, stops, and alerts once', () => {
  // The 16°C-floor case, driven rather than asserted: a room with more heat gain than the unit
  // can overcome must not keep trying forever.
  const TICK_MS = 60_000;
  const START = new Date('2026-08-24T08:00:00');
  let room = 33;
  let commanded = 25;
  let st = { commanded_c: commanded, last_step_at: null, last_direction: null, alert_kind: null };
  let raised = 0;

  for (let i = 0; i < 200; i++) {
    const now = new Date(START.getTime() + i * TICK_MS);
    const p = planSetpoint({
      rules: [rule({ window_start: '00:00', window_end: '23:59', days: '1111111' })],
      readings: {
        acu_main: { device_id: 'acu_main', ts: now.toISOString(), online: true, state: 'on', setpoint_c: commanded },
        sens_room: { device_id: 'sens_room', ts: now.toISOString(), online: true, temp_c: Number(room.toFixed(2)) },
      },
      now,
      state: { r1: st },
      policy: { acu_min_room_target_c: 24 },
      deviceById: DEVICES,
      dispatchableDeviceIds: ['acu_main'],
      recentCommands: {},
    });
    for (const a of p.alerts) if (a.transition === 'raised') raised += 1;
    if (p.alerts.length > 0) st = { ...st, alert_kind: p.alerts[p.alerts.length - 1].transition === 'raised' ? p.alerts[p.alerts.length - 1].kind : null };
    if (p.actions.length > 0) {
      commanded = p.actions[0].target_c;
      st = { ...st, commanded_c: commanded, last_step_at: now.toISOString(), last_direction: p.actions[0].direction };
    }
    room += 0.12 * (commanded + 12 - room); // 12°C of gain: unbeatable
  }

  assert.equal(commanded, 16, 'it walks down to the floor and stops there');
  assert.equal(raised, 1, 'and says so exactly once, not on every tick for three hours');
});
