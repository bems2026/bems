/**
 * Flow-node removal for an enrolled device — the mirror of enrolment.
 *
 * Enrolment's invariants are "additive only". Removal's are the exact opposite and need the
 * same care, because a subtractive write to a live flow has a failure mode enrolment does not:
 * taking out a node something else still wires TO leaves a dangling reference, and Node-RED
 * accepts that write. The result is a flow that loads but routes messages into nothing, which
 * looks like a dead device rather than a bad edit.
 *
 * `shared/registry.enrolled.mjs` already records why removal deletes rather than retires: the
 * history in `readings` is keyed by `device_id` and survives regardless, so a `status` flag
 * nothing reads would be the weaker of the two.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planEnrollment, planRemoval, validateRemovalPlan } from '../node-red-bridge/enrollPlan.mjs';

const entry = { id: 'co8', display_name: 'Outlet 8', class: 'outlet_dual', ctx: 'co8', dps_map: 'type_b' };
const creds = { tuyaDeviceId: 'vendor-new', localKey: 'k'.repeat(16), tuyaVersion: '3.4' };
const place = { z: 'tabOutlet', x: 200, y: 900 };
const base = () => [{ id: 'tabOutlet', type: 'tab', label: 'Outlet' }];

/** A flow with co8 enrolled — built through the real planner so the two stay in step. */
const enrolled = () => planEnrollment(base(), entry, creds, place).flows;

test('removes exactly the two nodes enrolment added, and nothing else', () => {
  const before = enrolled();
  const { flows, removed, problems } = planRemoval(before, 'co8');
  assert.deepEqual(problems, []);
  assert.equal(removed.length, 2);
  assert.equal(flows.length, before.length - 2);
  assert.ok(flows.some((n) => n.id === 'tabOutlet'), 'the tab itself must survive');
});

test('enrolling then removing returns the flow to exactly what it was', () => {
  // The strongest statement of "mirror": a round trip is the identity function. If removal
  // ever cleans up more or less than enrolment created, this is what catches it.
  const original = base();
  const after = planEnrollment(original, entry, creds, place).flows;
  const { flows } = planRemoval(after, 'co8');
  assert.deepEqual(flows, original);
});

test('refuses a device that is not in the flow rather than silently succeeding', () => {
  const { problems } = planRemoval(enrolled(), 'co9');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /co9/);
});

test('clears wires that pointed at a removed node instead of leaving them dangling', () => {
  // Node-RED accepts a write with a dangling wire; the flow then loads and routes into
  // nothing, which reads as a dead device rather than a bad edit.
  const before = enrolled();
  const injector = { id: 'inj1', type: 'inject', z: 'tabOutlet', wires: [['bems_enrolled_co8', 'tabOutlet']] };
  const { flows, problems } = planRemoval([...before, injector], 'co8');
  assert.deepEqual(problems, []);
  const kept = flows.find((n) => n.id === 'inj1');
  assert.deepEqual(kept.wires, [['tabOutlet']], 'the removed target goes, the surviving one stays');
});

test('the invariants reject a plan that removed the wrong number of nodes', () => {
  const before = enrolled();
  const after = before.filter((n) => n.id !== 'bems_enrolled_co8'); // parser left behind
  const problems = validateRemovalPlan(before, after, 'co8');
  assert.ok(problems.length > 0);
});

test('the invariants reject a plan that modified a node it should only have kept', () => {
  const before = enrolled();
  const { flows } = planRemoval(before, 'co8');
  const tampered = flows.map((n) => (n.id === 'tabOutlet' ? { ...n, label: 'Renamed' } : n));
  const problems = validateRemovalPlan(before, tampered, 'co8');
  assert.ok(problems.some((p) => /modified/.test(p)));
});

test('the invariants reject a plan that left a dangling wire', () => {
  const before = [...enrolled(), { id: 'inj1', type: 'inject', z: 'tabOutlet', wires: [['bems_enrolled_co8']] }];
  // A naive removal: drop the two nodes, leave the injector's wire pointing at nothing.
  const naive = before.filter((n) => !n.id.startsWith('bems_enrolled_co8'));
  const problems = validateRemovalPlan(before, naive, 'co8');
  assert.ok(problems.some((p) => /non-existent/.test(p)));
});

test('the invariants accept the real plan', () => {
  const before = [...enrolled(), { id: 'inj1', type: 'inject', z: 'tabOutlet', wires: [['bems_enrolled_co8']] }];
  const { flows } = planRemoval(before, 'co8');
  assert.deepEqual(validateRemovalPlan(before, flows, 'co8'), []);
});

test('removes a lighting circuit, whose companion is a tag node rather than a parser', () => {
  // Removal derives every id enrolment could have created and filters by presence, so it does
  // not need to know the class — and cannot miss a companion by reading the class wrongly.
  const lightEntry = { id: 'l8', display_name: 'Light Switch 8', class: 'switch', ctx: null, dps_map: null, state_key: 'L8' };
  const before = [
    { id: 'tabLights', type: 'tab', label: 'Lights' },
    { id: 'st_collect', type: 'function', z: 'tabLights', name: 'Collect status', wires: [[]] },
  ];
  const withLight = planEnrollment(before, lightEntry, creds, { z: 'tabLights', x: 100, y: 100 }).flows;
  const { flows, removed, problems } = planRemoval(withLight, 'l8');
  assert.deepEqual(problems, []);
  assert.equal(removed.length, 2);
  assert.deepEqual(flows, before, 'a light round-trips to the original flow too');
  assert.deepEqual(validateRemovalPlan(withLight, flows, 'l8'), []);
});
