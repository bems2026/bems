/**
 * Flow-node generation for an enrolled device.
 *
 * The generated parser is checked for the properties that were learned the hard way rather
 * than for its exact text: that it reads this device's own DPS numbers, that it carries a
 * reading forward instead of zeroing it, and that it stamps `_last_time` only when data
 * actually arrived. Each of those is a bug this project has already shipped once.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planEnrollment, validateEnrollmentPlan } from '../node-red-bridge/enrollPlan.mjs';
import { TUYA_FIND_TIMEOUT } from '../shared/tuyaNodeSettings.mjs';

const entry = { id: 'co8', display_name: 'Outlet 8', class: 'outlet_dual', ctx: 'co8', dps_map: 'type_b' };
const creds = { tuyaDeviceId: 'vendor-new', localKey: 'k'.repeat(16), tuyaVersion: '3.4' };
const place = { z: 'tabOutlet', x: 200, y: 900 };
const flow = () => [{ id: 'tabOutlet', type: 'tab', label: 'Outlet' }];

test('adds a device node and its parser, wired together', () => {
  const { added, flows } = planEnrollment(flow(), entry, creds, place);
  assert.equal(added.length, 2);
  const dev = flows.find((n) => n.type === 'tuya-smart-device');
  const parser = flows.find((n) => n.type === 'function');
  // BOTH ports, as every real node in the flow has. A tuya-smart-device in 'event-both'
  // mode emits data on port 1 and status on port 2; wiring only port 1 means CONNECTED and
  // DISCONNECTED never reach the parser, so its health branch can only ever set isOnline
  // true (via `else if (dps)`) and the device never goes offline. This asserted the
  // single-port shape until 2026-08-25 — the test encoded the bug.
  assert.deepEqual(dev.wires, [[parser.id], [parser.id]]);
});

test('carries the settings this project measured, not the library defaults', () => {
  // findTimeout at 1000ms caught one broadcast in five; a wrong version fails as
  // `find() timed out`. Both cost days.
  const { flows } = planEnrollment(flow(), entry, creds, place);
  const dev = flows.find((n) => n.type === 'tuya-smart-device');
  assert.equal(dev.findTimeout, TUYA_FIND_TIMEOUT);
  assert.equal(dev.tuyaVersion, '3.4');
});

test('refuses to generate without a protocol version rather than defaulting one', () => {
  const { problems } = planEnrollment(flow(), entry, { ...creds, tuyaVersion: undefined }, place);
  assert.match(problems.join(), /protocol version missing/);
});

test('refuses a vendor device that already has a node', () => {
  // Two nodes on one device is the duplicate-session problem, generated fresh.
  const existing = [...flow(), { id: 'x', type: 'tuya-smart-device', deviceId: 'vendor-new', wires: [[]] }];
  assert.match(planEnrollment(existing, entry, creds, place).problems.join(), /already has a node/);
});

test('refuses to enrol the same device twice', () => {
  const once = planEnrollment(flow(), entry, creds, place);
  const twice = planEnrollment(once.flows, entry, { ...creds, tuyaDeviceId: 'other' }, place);
  assert.match(twice.problems.join(), /already enrolled/);
});

test('refuses a class with no ctx, which has no parser to generate', () => {
  const { problems } = planEnrollment(flow(), { ...entry, ctx: null }, creds, place);
  assert.match(problems.join(), /only metered classes/);
});

describe_parser();
function describe_parser() {
  const parserOf = (e) => planEnrollment(flow(), e, creds, place).flows.find((n) => n.type === 'function').func;

  test('reads this device\'s own DPS numbers', () => {
    // type_b is energy 17, current 18, power 19, voltage 20.
    const src = parserOf(entry);
    // Substring, not regex: the pattern is full of brackets and quotes, and an over-escaped
    // regex silently matches nothing rather than failing loudly.
    for (const dp of ['17', '18', '19', '20']) {
      assert.ok(src.includes(`dps["${dp}"]`), `expected the parser to read dps ${dp}`);
    }
  });

  test('uses a different device\'s DPS when the map differs', () => {
    const src = parserOf({ ...entry, ctx: 'x1', dps_map: 'type_a' });
    assert.match(src, /dps\["105"\]/);
    assert.equal(/dps\["17"\]/.test(src), false, 'must not carry another map\'s energy dp');
  });

  test('keys every context write on this device\'s ctx', () => {
    const src = parserOf(entry);
    for (const key of ['co8_health', 'co8_last_v', 'co8_last_c', 'co8_last_p', 'co8_energy']) {
      assert.match(src, new RegExp(key));
    }
  });

  test('carries a reading forward when its dps is absent, rather than zeroing it', () => {
    // Zeroing would report a real 0 W the device never sent — "no data" and "zero watts" are
    // different facts, the rule format.ts holds on the display side.
    assert.match(parserOf(entry), /if \(dps\["20"\] !== undefined\) lastV/);
  });

  test('stamps _last_time only when dps arrived', () => {
    // Stamping on a status event makes a reconnected-but-silent device look freshly
    // measured, which is the defect EX-033b was written for.
    const src = parserOf(entry);
    const stampIdx = src.indexOf('_last_time');
    const guardIdx = src.indexOf('if (dps) {');
    assert.ok(guardIdx > -1 && stampIdx > guardIdx, 'the stamp must sit inside the dps guard');
  });
}

describe_validate();
function describe_validate() {
  test('a clean plan passes', () => {
    const before = flow();
    const { flows } = planEnrollment(before, entry, creds, place);
    assert.deepEqual(validateEnrollmentPlan(before, flows), []);
  });

  test('catches a device node with no parser', () => {
    const before = flow();
    const { flows } = planEnrollment(before, entry, creds, place);
    const orphaned = flows.map((n) => (n.type === 'tuya-smart-device' ? { ...n, wires: [[]] } : n));
    assert.ok(validateEnrollmentPlan(before, orphaned).some((p) => p.includes('no parser')));
  });

  test('catches an existing node being modified', () => {
    const before = [...flow(), { id: 'keep', type: 'function', name: 'Existing', wires: [[]] }];
    const { flows } = planEnrollment(before, entry, creds, place);
    const tampered = flows.map((n) => (n.id === 'keep' ? { ...n, name: 'Changed' } : n));
    assert.ok(validateEnrollmentPlan(before, tampered).some((p) => p.includes('modified')));
  });
}

// ---------------------------------------------------------------------------
// Lighting circuits — a different flow topology from a metered outlet
// ---------------------------------------------------------------------------

/**
 * `ENROLLABLE_CLASSES` has always listed `switch`, and the wizard has always offered it, but
 * enrolling one was impossible: `registryEntryFor` sets `ctx: null` for a switch (a light has
 * no metering context — it writes into the shared `lightStatus` map instead), and
 * `planEnrollment` refused any entry without a ctx. The wizard let you fill the whole form in
 * and then failed at the plan step. Found 2026-08-25.
 *
 * A light's chain is device -> `change` node setting `msg.lightId` -> the shared `Collect
 * status` function. Only the first two are generated; the collector already exists and is
 * wired INTO, never modified.
 */
const lightEntry = { id: 'l8', display_name: 'Light Switch 8', class: 'switch', ctx: null, dps_map: null, state_key: 'L8' };
const lightFlow = () => [
  { id: 'tabLights', type: 'tab', label: 'Lights' },
  { id: 'st_collect', type: 'function', z: 'tabLights', name: 'Collect status', wires: [[]] },
];

test('enrols a lighting circuit, which has no metering context at all', () => {
  const { added, problems } = planEnrollment(lightFlow(), lightEntry, creds, { z: 'tabLights', x: 100, y: 100 });
  assert.deepEqual(problems, []);
  assert.equal(added.length, 2);
});

test('a light gets a tag node feeding the shared collector, not a metering parser', () => {
  const { flows } = planEnrollment(lightFlow(), lightEntry, creds, { z: 'tabLights', x: 100, y: 100 });
  const tag = flows.find((n) => n.type === 'change');
  assert.deepEqual(tag.rules, [{ t: 'set', p: 'lightId', pt: 'msg', to: '8', tot: 'num' }]);
  assert.deepEqual(tag.wires, [['st_collect']]);
  assert.equal(flows.filter((n) => n.type === 'function' && n.id !== 'st_collect').length, 0, 'no parser is generated for a light');
});

test('the light number comes from the id, so it cannot drift from state_key', () => {
  const { flows } = planEnrollment(lightFlow(), lightEntry, creds, { z: 'tabLights', x: 100, y: 100 });
  const tag = flows.find((n) => n.type === 'change');
  assert.equal(tag.rules[0].to, '8');
  assert.equal(tag.name, 'tag L8');
});

test('refuses a light when the collector it must feed is not in the flow', () => {
  // Wiring to a node that does not exist produces a flow that loads and routes into nothing.
  const noCollector = [{ id: 'tabLights', type: 'tab', label: 'Lights' }];
  const { problems } = planEnrollment(noCollector, lightEntry, creds, { z: 'tabLights', x: 100, y: 100 });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Collect status|st_collect/);
});

test('the additive invariants still hold for a light', () => {
  const before = lightFlow();
  const { flows } = planEnrollment(before, lightEntry, creds, { z: 'tabLights', x: 100, y: 100 });
  assert.deepEqual(validateEnrollmentPlan(before, flows), []);
});
