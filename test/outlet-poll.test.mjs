/**
 * The patch that gives outlets a periodic refresh.
 *
 * The invariant that matters most is that this patch only ADDS. It is the first flow change
 * here that touches a tab carrying live control logic without removing anything, and an
 * accidental rewire of an existing node would be far harder to spot than a missing one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planOutletPoll, validateOutletPoll, outletNodes, POLL_FN_ID, POLL_INJECT_ID, POLL_INTERVAL_S } from '../node-red-bridge/outletPollPlan.mjs';

const outlet = (id, name) => ({ id, type: 'tuya-smart-device', deviceName: name, deviceId: 'd' + id, z: 'tabOutlet', wires: [['p' + id]] });
const flow = () => [
  { id: 'tabOutlet', type: 'tab', label: 'Outlet' },
  outlet('n1', 'CO1'),
  outlet('n2', 'CO2'),
  { id: 'n9', type: 'tuya-smart-device', deviceName: 'Light Switch 1', deviceId: 'dl1', z: 'tabSwitch', wires: [[]] },
  { id: 'pn1', type: 'function', name: 'Outlet 1 Parser', wires: [[]] },
  { id: 'pn2', type: 'function', name: 'Outlet 2 Parser', wires: [[]] },
];

test('targets outlets only, never switches or meters', () => {
  assert.deepEqual(outletNodes(flow()).map((n) => n.deviceName), ['CO1', 'CO2']);
});

test('adds exactly two nodes and wires the poller to every outlet', () => {
  const { flows, added, targets } = planOutletPoll(flow());
  assert.equal(added.length, 2);
  assert.deepEqual(targets, ['CO1', 'CO2']);
  const fn = flows.find((n) => n.id === POLL_FN_ID);
  assert.deepEqual(fn.wires, [['n1', 'n2']]);
});

test('sends the operation the tuya node actually accepts', () => {
  const { flows } = planOutletPoll(flow());
  const fn = flows.find((n) => n.id === POLL_FN_ID);
  assert.match(fn.func, /operation:\s*'GET'/);
});

test('polls at the ingestion cadence, not faster', () => {
  // Polling faster than ingestion writes rows nothing reads.
  const { flows } = planOutletPoll(flow());
  assert.equal(flows.find((n) => n.id === POLL_INJECT_ID).repeat, String(POLL_INTERVAL_S));
  assert.equal(POLL_INTERVAL_S, 60);
});

test('is idempotent — running twice does not double the traffic', () => {
  const once = planOutletPoll(flow());
  const twice = planOutletPoll(once.flows);
  assert.equal(twice.unchanged, true);
  assert.match(twice.reason, /already present/);
  assert.equal(twice.flows.length, once.flows.length);
});

test('does nothing when there are no outlets, rather than adding a poller for nobody', () => {
  const { unchanged, reason } = planOutletPoll([{ id: 't', type: 'tab' }]);
  assert.equal(unchanged, true);
  assert.match(reason, /no outlet nodes/);
});

test('modifies no existing node — this patch only adds', () => {
  const before = flow();
  const { flows } = planOutletPoll(before);
  assert.deepEqual(validateOutletPoll(before, flows), []);
  for (const original of before) {
    assert.deepEqual(flows.find((n) => n.id === original.id), original, `${original.id} was altered`);
  }
});

test('validation catches an outlet the poller would miss', () => {
  const before = flow();
  const { flows } = planOutletPoll(before);
  const missing = flows.map((n) => (n.id === POLL_FN_ID ? { ...n, wires: [['n1']] } : n));
  assert.ok(validateOutletPoll(before, missing).some((p) => p.includes('n2')));
});

test('validation catches an existing node being modified', () => {
  const before = flow();
  const { flows } = planOutletPoll(before);
  const tampered = flows.map((n) => (n.id === 'n1' ? { ...n, wires: [[]] } : n));
  assert.ok(validateOutletPoll(before, tampered).some((p) => p.includes('modified')));
});

test('validation catches a removed node', () => {
  const before = flow();
  const { flows } = planOutletPoll(before);
  assert.ok(validateOutletPoll(before, flows.filter((n) => n.id !== 'pn1')).some((p) => p.includes('pn1')));
});

test('validation catches a dangling wire', () => {
  const before = flow();
  const { flows } = planOutletPoll(before);
  const dangling = flows.map((n) => (n.id === POLL_FN_ID ? { ...n, wires: [['nope']] } : n));
  assert.ok(validateOutletPoll(before, dangling).some((p) => p.includes('nope')));
});
