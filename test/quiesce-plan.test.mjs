/**
 * Quiescing a dead tuya node — the narrowest possible edit to a live flow.
 *
 * WHY THIS EXISTS: `NBRIC IR Blaster` and `Outside Temp` are not in the Tuya cloud project and
 * have never connected. Each retries `findDevice()` every ~10 s forever, filling the Node-RED
 * log with `find() timed out` and burning a discovery listen slot on hardware that will never
 * answer. The devices stay in the registry deliberately (RM-016 is "leave them"), so the fix is
 * to stop them trying, not to remove them.
 *
 * WHY THE INVARIANTS ARE THIS STRICT: this writes to the four hand-built source tabs, which
 * `build-flow.mjs` does not generate and nothing else in the repo can restore. `findTimeout`
 * and `tuyaVersion` live only there, and losing them presents as every device going offline —
 * which reads as a network fault and has already cost this project days. So the plan is
 * asserted to change exactly one boolean on exactly the named nodes, and nothing else at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planQuiesce, validateQuiescePlan } from '../node-red-bridge/quiescePlan.mjs';

const flow = () => [
  { id: 'tabAir', type: 'tab', label: 'Aircon' },
  { id: 'n1', type: 'tuya-smart-device', z: 'tabAir', deviceName: 'NBRIC IR Blaster', deviceId: 'x1', findTimeout: '10000', tuyaVersion: '3.3', disableAutoStart: false, wires: [['p1'], []] },
  { id: 'n2', type: 'tuya-smart-device', z: 'tabAir', deviceName: 'Outside Temp', deviceId: 'x2', findTimeout: '10000', tuyaVersion: '3.3', disableAutoStart: false, wires: [['p1'], []] },
  { id: 'n3', type: 'tuya-smart-device', z: 'tabAir', deviceName: 'CO1', deviceId: 'x3', findTimeout: '10000', tuyaVersion: '3.4', disableAutoStart: false, wires: [['p2'], ['p2']] },
  { id: 'p1', type: 'function', z: 'tabAir', name: 'Parse DPS 101/102', func: 'return null;', wires: [[]] },
];

const NAMES = ['NBRIC IR Blaster', 'Outside Temp'];

test('disables exactly the named nodes and leaves every other node alone', () => {
  const before = flow();
  const { flows, changed, problems } = planQuiesce(before, NAMES);
  assert.deepEqual(problems, []);
  assert.equal(changed.length, 2);
  assert.equal(flows.find((n) => n.id === 'n1').disableAutoStart, true);
  assert.equal(flows.find((n) => n.id === 'n2').disableAutoStart, true);
  assert.equal(flows.find((n) => n.id === 'n3').disableAutoStart, false, 'a healthy device must not be touched');
});

test('changes nothing except that one boolean — findTimeout and tuyaVersion survive', () => {
  // These two fields exist ONLY on the live flow. Nothing in the repo declares them, so a
  // script that dropped them would do so with no diff and no alarm.
  const { flows } = planQuiesce(flow(), NAMES);
  const n1 = flows.find((n) => n.id === 'n1');
  assert.equal(n1.findTimeout, '10000');
  assert.equal(n1.tuyaVersion, '3.3');
  assert.deepEqual(n1.wires, [['p1'], []]);
  assert.deepEqual(
    { ...n1, disableAutoStart: false },
    flow().find((n) => n.id === 'n1'),
    'the disabled node must differ from its original in disableAutoStart and nothing else',
  );
});

test('keeps the node count identical — this disables, it never removes', () => {
  const before = flow();
  const { flows } = planQuiesce(before, NAMES);
  assert.equal(flows.length, before.length);
});

test('refuses a name that is not in the flow rather than silently doing nothing', () => {
  const { problems } = planQuiesce(flow(), ['Ghost Device']);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Ghost Device/);
});

test('reports an already-disabled node as nothing to do, so re-running is honest', () => {
  const once = planQuiesce(flow(), NAMES).flows;
  const twice = planQuiesce(once, NAMES);
  assert.deepEqual(twice.problems, []);
  assert.equal(twice.changed.length, 0, 'already quiet, nothing changed');
  assert.deepEqual(twice.flows, once, 'and the flow is byte-identical');
});

test('the invariants accept the real plan', () => {
  const before = flow();
  const { flows } = planQuiesce(before, NAMES);
  assert.deepEqual(validateQuiescePlan(before, flows, NAMES), []);
});

test('the invariants reject a plan that removed a node', () => {
  const before = flow();
  const after = planQuiesce(before, NAMES).flows.filter((n) => n.id !== 'p1');
  assert.ok(validateQuiescePlan(before, after, NAMES).some((p) => /removed|count/i.test(p)));
});

test('the invariants reject a plan that touched a node it was not asked to', () => {
  const before = flow();
  const after = planQuiesce(before, NAMES).flows.map((n) => (n.id === 'n3' ? { ...n, disableAutoStart: true } : n));
  assert.ok(validateQuiescePlan(before, after, NAMES).some((p) => /CO1/.test(p)));
});

test('the invariants reject a plan that changed any other field on a named node', () => {
  // The exact failure this project has already paid days for.
  const before = flow();
  const after = planQuiesce(before, NAMES).flows.map((n) => (n.id === 'n1' ? { ...n, findTimeout: '1000' } : n));
  assert.ok(validateQuiescePlan(before, after, NAMES).some((p) => /findTimeout|modified/i.test(p)));
});
