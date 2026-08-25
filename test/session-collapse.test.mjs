/**
 * The plan that collapses two local sessions to one physical device.
 *
 * The invariant worth most here is that no parser loses its input: a parser with no upstream
 * does not error, it simply stops updating, and its readings freeze at whatever they last were.
 * That is the failure this project has already been bitten by twice, so it is asserted directly
 * rather than inferred from node counts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSessionCollapse, findDuplicateSessions, validateCollapse } from '../node-red-bridge/sessionCollapsePlan.mjs';

const tuya = (id, name, deviceId, wires) => ({ id, type: 'tuya-smart-device', deviceName: name, deviceId, wires });
const fn = (id, name) => ({ id, type: 'function', name, wires: [[]] });

/** The real shape: two nodes on one meter, each feeding its own parser. */
const flow = () => [
  { id: 'tab1', type: 'tab', label: 'Energy' },
  tuya('n1', 'C.O yellow', 'devA', [['p1'], ['p1']]),
  tuya('n2', 'L.O yellow', 'devA', [['p2'], ['p2']]),
  tuya('n3', 'L.O red', 'devB', [['p3'], ['p3']]),
  fn('p1', 'C.O Yellow Unified Parser'),
  fn('p2', 'L.O Yellow Unified Parser'),
  fn('p3', 'L.O red Parser'),
];

test('finds only devices with more than one session', () => {
  const dups = findDuplicateSessions(flow());
  assert.equal(dups.length, 1);
  assert.equal(dups[0].deviceId, 'devA');
});

test('keeps one node per device and retires the rest', () => {
  const { flows, collapse } = planSessionCollapse(flow());
  const sessions = flows.filter((n) => n.type === 'tuya-smart-device');
  assert.equal(sessions.length, 2, 'devA collapses to one, devB untouched');
  assert.deepEqual(collapse.map((c) => c.keep), ['C.O yellow']);
  assert.deepEqual(collapse[0].retire, ['L.O yellow']);
});

test('the survivor feeds BOTH parsers the pair fed between them', () => {
  const { flows } = planSessionCollapse(flow());
  const survivor = flows.find((n) => n.deviceName === 'C.O yellow');
  assert.deepEqual(survivor.wires, [['p1', 'p2']]);
});

test('no parser loses its input', () => {
  const before = flow();
  const { flows } = planSessionCollapse(before);
  assert.deepEqual(validateCollapse(before, flows), []);
});

test('a device with a single session is left completely alone', () => {
  const before = flow();
  const { flows } = planSessionCollapse(before);
  const red = flows.find((n) => n.deviceName === 'L.O red');
  assert.deepEqual(red.wires, [['p3'], ['p3']], 'untouched, including its two ports');
});

test('a flow with no duplicates is returned unchanged', () => {
  const single = [tuya('n1', 'A', 'devA', [['p1']]), fn('p1', 'P')];
  const { collapse, unchanged, flows } = planSessionCollapse(single);
  assert.equal(unchanged, true);
  assert.deepEqual(collapse, []);
  assert.equal(flows, single, 'same array, not a copy');
});

test('de-duplicates when both nodes already feed the same parser', () => {
  const shared = [tuya('n1', 'A', 'devA', [['p1']]), tuya('n2', 'B', 'devA', [['p1']]), fn('p1', 'P')];
  const { flows } = planSessionCollapse(shared);
  assert.deepEqual(flows.find((n) => n.id === 'n1').wires, [['p1']]);
});

test('the survivor is stable across runs, not chosen by name or wiring', () => {
  // Any preference based on merit would change the moment someone renamed a node, and a plan
  // that differs between a dry run and an apply is worse than no plan.
  const a = planSessionCollapse(flow()).collapse[0].keep;
  const b = planSessionCollapse(flow()).collapse[0].keep;
  assert.equal(a, b);
});

describe_validate();
function describe_validate() {
  test('validation catches a parser left with no input', () => {
    const before = flow();
    const broken = before.filter((n) => n.id !== 'n2').map((n) => ({ ...n }));
    // n2 removed without merging its wire into n1: p2 now has no upstream.
    const problems = validateCollapse(before, broken);
    assert.ok(problems.some((p) => p.includes('p2')), `expected p2 to be flagged, got ${JSON.stringify(problems)}`);
  });

  test('validation catches a wire pointing at a removed node', () => {
    const before = flow();
    const dangling = before.filter((n) => n.id !== 'p2').map((n) => ({ ...n }));
    const problems = validateCollapse(before, dangling);
    assert.ok(problems.some((p) => p.includes('p2')));
  });

  test('validation catches a device losing its only session', () => {
    const before = flow();
    const gone = before.filter((n) => n.id !== 'n3').map((n) => ({ ...n }));
    const problems = validateCollapse(before, gone);
    assert.ok(problems.some((p) => p.includes('devB')));
  });

  test('validation catches a removed HTTP endpoint', () => {
    const before = [...flow(), { id: 'h1', type: 'http in', url: '/light/:id', wires: [[]] }];
    const problems = validateCollapse(before, flow());
    assert.ok(problems.some((p) => p.includes('/light/:id')));
  });
}
