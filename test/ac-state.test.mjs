/**
 * The aircon's full-state command contract.
 *
 * An IR aircon has no readback and every IR frame carries the WHOLE state — power, mode,
 * setpoint, fan and swing together. So a command here is always absolute, the same rule
 * `shared/commands.mjs` holds for relays: "set fan high" is expanded into a complete state before
 * it goes anywhere, and both dispatch paths (the local IR library and the vendor cloud's DP route)
 * are handed that same complete state. If each path composed its own frame from its own memory,
 * a cloud command after a local one would quietly put back whatever the cloud last remembered.
 *
 * The Tuya enum spellings are measured, not assumed: the "Air" remote's thing model declares
 * `mode` "0".."4" and `fan` "0".."3", and Tuya's IR AC API reference names them
 * 0 cool / 1 heat / 2 auto / 3 fan / 4 dry and 0 auto / 1 low / 2 medium / 3 high.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AC_MODES,
  AC_FANS,
  AC_DEFAULTS,
  LOCAL_LIBRARY_STATE,
  resolveAcState,
  acStateToDps,
  localIrKey,
} from '../shared/acState.mjs';
import { validateCommand } from '../shared/commands.mjs';
import { DEVICE_REGISTRY } from '../shared/registry.mjs';

test('the mode and fan vocabularies follow the vendor enum order', () => {
  assert.deepEqual([...AC_MODES], ['cool', 'heat', 'auto', 'fan', 'dry']);
  assert.deepEqual([...AC_FANS], ['auto', 'low', 'medium', 'high']);
});

test('an ON command with every field is taken exactly as given', () => {
  const s = resolveAcState({ action: 'on', target_c: 22, mode: 'dry', fan: 'high', swing: true });
  assert.deepEqual(s, { power: 'on', mode: 'dry', setpoint_c: 22, fan: 'high', swing: true });
});

test('omitted fields come from the last COMMANDED state, so a setpoint step keeps the mode', () => {
  // This is what the closed loop sends: a setpoint and nothing else. It must not reset an
  // operator's "dry, fan high, swing on" back to the defaults.
  const last = { setpoint_c: 25, ac_mode: 'dry', ac_fan: 'high', ac_swing: true };
  const s = resolveAcState({ action: 'on', target_c: 24 }, last);
  assert.deepEqual(s, { power: 'on', mode: 'dry', setpoint_c: 24, fan: 'high', swing: true });
});

test('with no history at all, the defaults fill the gaps', () => {
  const s = resolveAcState({ action: 'on' }, {});
  assert.deepEqual(s, { power: 'on', ...AC_DEFAULTS });
});

test('swing=false from the caller is honoured, not treated as missing', () => {
  const s = resolveAcState({ action: 'on', swing: false }, { ac_swing: true });
  assert.equal(s.swing, false);
});

test('an OFF command resolves to power off and still carries the remembered state', () => {
  const s = resolveAcState({ action: 'off' }, { setpoint_c: 26, ac_mode: 'cool', ac_fan: 'low', ac_swing: false });
  assert.equal(s.power, 'off');
  assert.equal(s.setpoint_c, 26);
});

test('a remembered value outside the vocabulary is not carried forward', () => {
  // A reading is data from the network; a garbled mode must fall back to the default rather than
  // be sent to a vendor API as if it were a real one.
  const s = resolveAcState({ action: 'on' }, { ac_mode: 'turbo', ac_fan: 7, ac_swing: 'yes', setpoint_c: 99 });
  assert.deepEqual(s, { power: 'on', ...AC_DEFAULTS });
});

test('the cloud DP properties are the Air remote codes, with vendor enum strings', () => {
  const dps = acStateToDps({ power: 'on', mode: 'dry', setpoint_c: 24, fan: 'high', swing: true });
  assert.deepEqual(dps, { switch_power: true, mode: '4', temperature: 24, fan: '3', swing: true });
});

test('OFF sends the power property alone', () => {
  // Issuing mode or temperature with power off could be composed into a frame that turns the
  // unit on. Off is off.
  assert.deepEqual(acStateToDps({ power: 'off', mode: 'dry', setpoint_c: 24, fan: 'high', swing: true }), { switch_power: false });
});

test('the local IR library covers OFF and its own state at 16..30 only', () => {
  assert.equal(localIrKey({ power: 'off' }), 'OFF');
  assert.equal(localIrKey({ power: 'on', ...LOCAL_LIBRARY_STATE, setpoint_c: 16 }), '16');
  assert.equal(localIrKey({ power: 'on', ...LOCAL_LIBRARY_STATE, setpoint_c: 30 }), '30');
  assert.equal(localIrKey({ power: 'on', ...LOCAL_LIBRARY_STATE, setpoint_c: 31 }), null);
  assert.equal(localIrKey({ power: 'on', ...LOCAL_LIBRARY_STATE, mode: 'dry', setpoint_c: 24 }), null);
  assert.equal(localIrKey({ power: 'on', ...LOCAL_LIBRARY_STATE, fan: 'high', setpoint_c: 24 }), null);
  assert.equal(localIrKey({ power: 'on', ...LOCAL_LIBRARY_STATE, swing: !LOCAL_LIBRARY_STATE.swing, setpoint_c: 24 }), null);
});

// --- the command contract --------------------------------------------------------------------

const v = (body) => validateCommand(body, DEVICE_REGISTRY);

test('an aircon command with no mode/fan/swing is byte-identical to what it always was', () => {
  const r = v({ device_id: 'acu_main', action: 'on', target_c: 24 });
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.cmd).sort(), ['action', 'command_id', 'device_id', 'socket', 'target', 'target_c'].sort());
});

test('mode, fan and swing are carried for the aircon', () => {
  const r = v({ device_id: 'acu_main', action: 'on', target_c: 24, mode: 'dry', fan: 'high', swing: true });
  assert.equal(r.ok, true);
  assert.equal(r.cmd.mode, 'dry');
  assert.equal(r.cmd.fan, 'high');
  assert.equal(r.cmd.swing, true);
});

test('an unknown mode, fan or a non-boolean swing is refused', () => {
  assert.equal(v({ device_id: 'acu_main', action: 'on', mode: 'turbo' }).code, 'invalid_mode');
  assert.equal(v({ device_id: 'acu_main', action: 'on', fan: 'max' }).code, 'invalid_fan');
  assert.equal(v({ device_id: 'acu_main', action: 'on', fan: '3' }).code, 'invalid_fan');
  assert.equal(v({ device_id: 'acu_main', action: 'on', swing: 'on' }).code, 'invalid_swing');
});

test('mode, fan and swing belong to the aircon and nothing else', () => {
  assert.equal(v({ device_id: 'l1', action: 'on', mode: 'cool' }).code, 'ac_state_not_applicable');
  assert.equal(v({ device_id: 'co1', socket: 1, action: 'on', fan: 'low' }).code, 'ac_state_not_applicable');
  assert.equal(v({ device_id: 'l1', action: 'on', swing: false }).code, 'ac_state_not_applicable');
});
