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

test('adds exactly two nodes and gives every outlet its own output', () => {
  // One output per outlet, not one output fanned out to all of them. The fan-out shape cannot
  // express "poll all but that one", which is what skipping a disconnected outlet requires.
  const { flows, added, targets } = planOutletPoll(flow());
  assert.equal(added.length, 2);
  assert.deepEqual(targets, ['CO1', 'CO2']);
  const fn = flows.find((n) => n.id === POLL_FN_ID);
  assert.equal(fn.outputs, 2);
  assert.deepEqual(fn.wires, [['n1'], ['n2']]);
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
  const missing = flows.map((n) => (n.id === POLL_FN_ID ? { ...n, outputs: 1, wires: [['n1']] } : n));
  assert.ok(validateOutletPoll(before, missing).some((p) => p.includes('CO2')));
});

test('validation rejects the old fan-out shape, which cannot skip anything', () => {
  // One output wired to every outlet passes "reaches every outlet" while being exactly the
  // shape this revision replaces. Without this check the upgrade could silently no-op.
  const before = flow();
  const { flows } = planOutletPoll(before);
  const fannedOut = flows.map((n) => (n.id === POLL_FN_ID ? { ...n, outputs: 1, wires: [['n1', 'n2']] } : n));
  const problems = validateOutletPoll(before, fannedOut);
  assert.ok(problems.some((p) => /1 output\(s\) for 2 outlets/.test(p)), problems.join(' | '));
});

test('validation rejects a poll function that names no health key, so the outputs would skip nothing', () => {
  const before = flow();
  const { flows } = planOutletPoll(before);
  const inert = flows.map((n) => (n.id === POLL_FN_ID ? { ...n, func: 'return [{payload:{operation:"GET"}},{payload:{operation:"GET"}}];' } : n));
  assert.ok(validateOutletPoll(before, inert).some((p) => /cannot be skipped/.test(p)));
});

test('a disconnected outlet is skipped, and an unknown one is still polled', () => {
  // Executed rather than pattern-matched: the function body is a string that ships to Node-RED,
  // so the only honest way to assert what it does is to run it. `co1` is flagged down, `co2`
  // has no health key at all — a wiped context, or a device that has never reported.
  const { flows } = planOutletPoll(flow());
  const fn = flows.find((n) => n.id === POLL_FN_ID);
  const health = { co1_health: false };
  const run = new Function('flow', fn.func);
  const out = run({ get: (k) => health[k] });
  assert.equal(out[0], null, 'a disconnected outlet must not be polled');
  assert.deepEqual(out[1], { payload: { operation: 'GET' } }, 'unknown must still be polled — refusing would keep it silent forever');
});

test('a recovered outlet is polled again with no intervention', () => {
  // The self-healing property, and the reason this is preferred over quiescing: the tuya node's
  // own reconnect loop is untouched, so when its parser sets health true the poller resumes by
  // itself. Quiescing would need a manual --undo after the site visit.
  const { flows } = planOutletPoll(flow());
  const fn = flows.find((n) => n.id === POLL_FN_ID);
  const run = new Function('flow', fn.func);
  const health = { co1_health: false };
  assert.equal(run({ get: (k) => health[k] })[0], null);
  health.co1_health = true;
  assert.deepEqual(run({ get: (k) => health[k] })[0], { payload: { operation: 'GET' } });
});

test('an earlier single-output poller is upgraded in place, not left alone', () => {
  // "Already present, nothing to do" would silently decline to fix the thing somebody ran this
  // to fix. The upgrade adds no nodes and touches only the poll function.
  const before = flow();
  const { flows: installed } = planOutletPoll(before);
  const legacy = installed.map((n) =>
    n.id === POLL_FN_ID ? { ...n, outputs: 1, wires: [['n1', 'n2']], func: "msg.payload = { operation: 'GET' };\nreturn msg;" } : n,
  );

  const { flows: after, added, upgraded, unchanged } = planOutletPoll(legacy);
  assert.equal(unchanged, false);
  assert.equal(added.length, 0, 'an upgrade must add no nodes');
  assert.deepEqual(upgraded, [POLL_FN_ID]);
  const fn = after.find((n) => n.id === POLL_FN_ID);
  assert.equal(fn.outputs, 2);
  assert.deepEqual(fn.wires, [['n1'], ['n2']]);
  assert.deepEqual(validateOutletPoll(legacy, after), []);
});

test('an already-current poller is left completely alone', () => {
  const { flows: once } = planOutletPoll(flow());
  const { flows: twice, unchanged, reason } = planOutletPoll(once);
  assert.equal(unchanged, true);
  assert.match(reason, /current/);
  assert.equal(JSON.stringify(twice), JSON.stringify(once));
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
