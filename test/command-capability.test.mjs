/**
 * Capability writes — the command contract's second verb.
 *
 * `action` has always been `on`/`off`, absolute and never a toggle, and that stays true for
 * relays. What it could not express is everything else a device holds: a child lock, an auto-off
 * countdown, an over-power alarm threshold. Those were readable from the moment
 * `shared/deviceCapabilities.mjs` landed and writable from nowhere.
 *
 * The rules under test are mostly refusals, because this is the file standing between a JSON
 * body and a device on a live building's electrical panel:
 *
 *   - Only capabilities the CATALOGUE marks writable. The vendor marks four more `rw` —
 *     relay_status, switch_inching, cycle_time, random_time — and each installs unattended
 *     switching inside the device, invisible to the scheduler and unrecordable in the audit
 *     trail. A validator that trusted `access: 'rw'` would open all four.
 *   - Bounds come from the vendor's own declaration, never from a constant here.
 *   - A channel's capability belongs to that channel. One physical dual-channel meter is two
 *     logical devices, and writing channel 1's alarm threshold onto channel 2 would arm the
 *     wrong branch circuit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateCommand, buildAck } from '../shared/commands.mjs';
import { DEVICE_REGISTRY } from '../shared/registry.mjs';

const ok = (body) => validateCommand(body, DEVICE_REGISTRY);
const fail = (body) => {
  const r = validateCommand(body, DEVICE_REGISTRY);
  assert.equal(r.ok, false, `expected a refusal for ${JSON.stringify(body)}`);
  return r;
};

test('a relay command is completely unchanged', () => {
  // Every existing caller, row and reader must keep working exactly as before.
  const r = ok({ device_id: 'l1', action: 'on' });
  assert.equal(r.ok, true);
  assert.equal(r.cmd.action, 'on');
  assert.equal(r.cmd.target, 'L1');
  assert.equal(r.cmd.capability, undefined);
  assert.equal(r.cmd.value, undefined);
});

test('a boolean capability is accepted on a device that has it', () => {
  const r = ok({ device_id: 'co3', action: 'set', capability: 'child_lock', value: true });
  assert.equal(r.ok, true);
  assert.equal(r.cmd.capability, 'child_lock');
  assert.equal(r.cmd.value, true);
  // `target` records what was actually addressed, so the audit row reads as itself.
  assert.equal(r.cmd.target, 'child_lock');
});

test('a capability the device does not have is refused', () => {
  // A light switch has no child lock. This is the resilience rule the UI relies on, enforced
  // server-side because a UI that hides a control is not enforcement.
  const r = fail({ device_id: 'l1', action: 'set', capability: 'child_lock', value: true });
  assert.equal(r.code, 'unknown_capability');
  assert.equal(r.status, 400);
});

test('a capability the vendor allows but this system refuses is still refused', () => {
  // relay_status decides what the relay does after a power cut, unattended, with nothing in the
  // audit trail to explain it afterwards. The vendor marks it `rw`; the catalogue does not.
  for (const capability of ['relay_status', 'cycle_time']) {
    const r = fail({ device_id: 'co3', action: 'set', capability, value: 'memory' });
    assert.equal(r.code, 'capability_not_writable', capability);
  }
  const inching = fail({ device_id: 'l1', action: 'set', capability: 'switch_inching', value: 'AAAC' });
  assert.equal(inching.code, 'capability_not_writable');
});

test('a meter accepts a capability write even though it has no relay', () => {
  // `not_commandable` is a statement about relay state, and a meter genuinely has none. It does
  // have an alarm threshold, and refusing that on class grounds would be the wrong reading of
  // the same rule.
  const r = ok({ device_id: 'mtr_lo_red', action: 'set', capability: 'warn_power', value: 1500 });
  assert.equal(r.ok, true);
  assert.equal(r.cmd.capability, 'warn_power1', 'resolved to this device’s own channel');
  // ...while a relay command to a meter is refused exactly as before.
  assert.equal(fail({ device_id: 'mtr_lo_red', action: 'on' }).code, 'not_commandable');
});

test('the channel suffix is resolved from the device, not taken from the caller', () => {
  // Two logical meters, one physical device. A caller naming a bare `warn_power` must reach its
  // own channel; naming the other channel's code outright must be refused rather than obeyed.
  assert.equal(ok({ device_id: 'mtr_co_yellow', action: 'set', capability: 'warn_power', value: 1500 }).cmd.capability, 'warn_power1');
  assert.equal(ok({ device_id: 'mtr_lo_yellow', action: 'set', capability: 'warn_power', value: 1500 }).cmd.capability, 'warn_power2');
  assert.equal(fail({ device_id: 'mtr_lo_yellow', action: 'set', capability: 'warn_power1', value: 1500 }).code, 'unknown_capability');
});

test('numeric bounds come from the vendor declaration', () => {
  // warn_power is min 200, max 50000, step 100 — measured from the device model, not chosen here.
  assert.equal(ok({ device_id: 'mtr_lo_red', action: 'set', capability: 'warn_power', value: 200 }).ok, true);
  assert.equal(ok({ device_id: 'mtr_lo_red', action: 'set', capability: 'warn_power', value: 50000 }).ok, true);
  assert.equal(fail({ device_id: 'mtr_lo_red', action: 'set', capability: 'warn_power', value: 100 }).code, 'value_out_of_range');
  assert.equal(fail({ device_id: 'mtr_lo_red', action: 'set', capability: 'warn_power', value: 50100 }).code, 'value_out_of_range');
  assert.equal(fail({ device_id: 'mtr_lo_red', action: 'set', capability: 'warn_power', value: 1550 }).code, 'value_off_step');
});

test('countdown accepts its own seconds range, per socket', () => {
  assert.equal(ok({ device_id: 'co3', action: 'set', capability: 'countdown_1', value: 0 }).ok, true);
  assert.equal(ok({ device_id: 'co3', action: 'set', capability: 'countdown_2', value: 86400 }).ok, true);
  assert.equal(fail({ device_id: 'co3', action: 'set', capability: 'countdown_1', value: 86401 }).code, 'value_out_of_range');
  // A light switch has one relay and therefore one countdown.
  assert.equal(ok({ device_id: 'l1', action: 'set', capability: 'countdown_1', value: 600 }).ok, true);
  assert.equal(fail({ device_id: 'l1', action: 'set', capability: 'countdown_2', value: 600 }).code, 'unknown_capability');
});

test('a value of the wrong type is refused rather than coerced', () => {
  assert.equal(fail({ device_id: 'co3', action: 'set', capability: 'child_lock', value: 'true' }).code, 'invalid_value');
  assert.equal(fail({ device_id: 'co3', action: 'set', capability: 'countdown_1', value: '600' }).code, 'invalid_value');
  assert.equal(fail({ device_id: 'co3', action: 'set', capability: 'countdown_1', value: 1.5 }).code, 'invalid_value');
  assert.equal(fail({ device_id: 'mtr_lo_red', action: 'set', capability: 'warn_power' }).code, 'invalid_value');
});

test('an enum value must be one the device declares', () => {
  assert.equal(ok({ device_id: 'mtr_lo_red', action: 'set', capability: 'sync_response', value: 'ok' }).ok, true);
  // 'clear' is accepted by the single-channel meter and NOT by the dual-channel one; the two
  // products genuinely declare different ranges.
  assert.equal(ok({ device_id: 'mtr_lo_red', action: 'set', capability: 'sync_response', value: 'clear' }).ok, true);
  assert.equal(fail({ device_id: 'mtr_co_yellow', action: 'set', capability: 'sync_response', value: 'clear' }).code, 'value_out_of_range');
  assert.equal(fail({ device_id: 'mtr_lo_red', action: 'set', capability: 'sync_response', value: 'go' }).code, 'value_out_of_range');
});

test('sync_request is refused — it is the read-only half of the handshake', () => {
  const r = fail({ device_id: 'mtr_lo_red', action: 'set', capability: 'sync_request', value: 'request' });
  assert.equal(r.code, 'capability_not_writable');
});

test('a device with no capability profile refuses every capability write', () => {
  // The IR blaster and the ambient sensor have no dps at all.
  assert.equal(fail({ device_id: 'acu_main', action: 'set', capability: 'child_lock', value: true }).code, 'unknown_capability');
});

test('the two verbs do not accept each other’s fields', () => {
  assert.equal(fail({ device_id: 'co3', action: 'on', capability: 'child_lock', value: true }).code, 'capability_not_applicable');
  assert.equal(fail({ device_id: 'co3', action: 'set', capability: 'child_lock', value: true, socket: 1 }).code, 'socket_not_applicable');
  assert.equal(fail({ device_id: 'co3', action: 'set' }).code, 'invalid_capability');
  assert.equal(fail({ device_id: 'acu_main', action: 'set', capability: 'child_lock', value: true, target_c: 24 }).code, 'unknown_capability');
});

test('an unknown action is still refused, and names both verbs', () => {
  const r = fail({ device_id: 'l1', action: 'toggle' });
  assert.equal(r.code, 'invalid_action');
  assert.match(r.error, /set/);
});

test('the ack carries the capability and value so a client can log what it asked for', () => {
  const { cmd } = ok({ device_id: 'co3', action: 'set', capability: 'child_lock', value: true });
  const ack = buildAck({ ...cmd, command_id: 'abc' }, 1786000000000);
  assert.equal(ack.action, 'set');
  assert.equal(ack.capability, 'child_lock');
  assert.equal(ack.value, true);
  // Still never claimed as confirmed: these devices do not report a setting back either.
  assert.equal(ack.confirmed, false);
  assert.equal(ack.confirmation, 'none');
});

test('a relay ack does not grow capability fields', () => {
  const { cmd } = ok({ device_id: 'l1', action: 'off' });
  const ack = buildAck(cmd, 1786000000000);
  assert.equal(Object.hasOwn(ack, 'capability'), false);
  assert.equal(Object.hasOwn(ack, 'value'), false);
});
