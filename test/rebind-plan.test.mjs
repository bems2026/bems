/**
 * Rebinding a flow node to a re-paired device, as a pure plan.
 *
 * WHY: re-pairing a device in Smart Life gives it a new vendor id and local key. The node polling it
 * then points at nothing — and on 2026-09-17 the IR blaster's was fixed by pasting the new id and key
 * into the Node-RED editor by hand, which is exactly the secret-copying enrolment was built to end.
 *
 * The invariants are the quiesce plan's, widened by exactly the fields a re-pair changes: one named
 * node, its `deviceId`, `deviceKey` and announced `tuyaVersion` (and optionally waking it), nothing
 * else — its `findTimeout`, wiring and parsers are what a rebind exists to keep.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planRebind, validateRebindPlan } from '../node-red-bridge/rebindPlan.mjs';

const FLOW = () => [
  { id: 'tab', type: 'tab', label: 'Aircon' },
  {
    id: 'ir', type: 'tuya-smart-device', z: 'tab', deviceName: 'NBRIC IR Blaster', disableAutoStart: true,
    deviceId: 'old-id', deviceKey: 'old-key-16chars!', tuyaVersion: '3.3', findTimeout: '10000', retryTimeout: '1000', wires: [['p'], ['p']],
  },
  { id: 'co5', type: 'tuya-smart-device', z: 'tab', deviceName: 'CO5', deviceId: 'co5-id', deviceKey: 'k', tuyaVersion: '3.4', findTimeout: '10000', wires: [[]] },
  { id: 'p', type: 'function', z: 'tab', name: 'parser', func: 'return msg;', wires: [[]] },
];
const creds = { tuyaDeviceId: 'new-id', localKey: 'new-key-16chars!', tuyaVersion: '3.3' };

test('changes exactly the id, key and version of the named node, and wakes it', () => {
  const before = FLOW();
  const plan = planRebind(before, { nodeName: 'NBRIC IR Blaster', ...creds });
  assert.deepEqual(plan.problems, []);
  const ir = plan.flows.find((n) => n.id === 'ir');
  assert.deepEqual([ir.deviceId, ir.deviceKey, ir.tuyaVersion, ir.disableAutoStart], ['new-id', 'new-key-16chars!', '3.3', false]);
  assert.equal(ir.findTimeout, '10000');
  assert.deepEqual(ir.wires, [['p'], ['p']]);
  assert.deepEqual(validateRebindPlan(before, plan.flows, 'NBRIC IR Blaster'), []);
});

test('can leave a quiesced node quiesced', () => {
  const plan = planRebind(FLOW(), { nodeName: 'NBRIC IR Blaster', ...creds, enable: false });
  assert.equal(plan.flows.find((n) => n.id === 'ir').disableAutoStart, true);
});

test('the change summary never carries a key', () => {
  const plan = planRebind(FLOW(), { nodeName: 'NBRIC IR Blaster', ...creds });
  assert.equal(JSON.stringify(plan.changed).includes('16chars'), false);
  assert.deepEqual(plan.changed.sort(), ['deviceId', 'deviceKey', 'disableAutoStart'].sort());
});

test('refuses a node that is not there', () => {
  assert.match(planRebind(FLOW(), { nodeName: 'Nope', ...creds }).problems.join(' '), /no tuya-smart-device node named "Nope"/);
});

test('refuses a vendor id another node already polls — two sessions to one device exhaust it', () => {
  assert.match(planRebind(FLOW(), { nodeName: 'NBRIC IR Blaster', ...creds, tuyaDeviceId: 'co5-id' }).problems.join(' '), /already polled by "CO5"/);
});

test('refuses a version that is not a Tuya protocol, or a missing key', () => {
  assert.match(planRebind(FLOW(), { nodeName: 'NBRIC IR Blaster', ...creds, tuyaVersion: '9.9' }).problems.join(' '), /protocol version/);
  assert.match(planRebind(FLOW(), { nodeName: 'NBRIC IR Blaster', ...creds, localKey: '' }).problems.join(' '), /local key/);
});

test('re-running with the same credentials is a no-op', () => {
  const once = planRebind(FLOW(), { nodeName: 'NBRIC IR Blaster', ...creds });
  const twice = planRebind(once.flows, { nodeName: 'NBRIC IR Blaster', ...creds });
  assert.deepEqual(twice.changed, []);
  assert.deepEqual(twice.flows, once.flows);
});

test('the invariants refuse any other field, any other node, and any change in node count', () => {
  const before = FLOW();
  const plan = planRebind(before, { nodeName: 'NBRIC IR Blaster', ...creds });
  const timeout = plan.flows.map((n) => (n.id === 'ir' ? { ...n, findTimeout: '1000' } : n));
  assert.match(validateRebindPlan(before, timeout, 'NBRIC IR Blaster').join(' '), /findTimeout/);
  const other = plan.flows.map((n) => (n.id === 'co5' ? { ...n, tuyaVersion: '3.5' } : n));
  assert.match(validateRebindPlan(before, other, 'NBRIC IR Blaster').join(' '), /CO5/);
  assert.match(validateRebindPlan(before, plan.flows.slice(1), 'NBRIC IR Blaster').join(' '), /node count/);
});
