/**
 * The Aircon tab refactor, planned against the tab as it really is.
 *
 * `test/fixtures/aircon-tab-live-2026-09-17.json` is the live Aircon tab read off the Pi the day
 * the IR blaster was re-paired — every node, wire and function source, with the two device ids
 * and local keys redacted. The committed `live-flow-baseline.json` is weeks older (it still has
 * the collapsed `ACU` node and none of the discovery back-off nodes), so planning against it would
 * test a tab that no longer exists.
 *
 * The invariants are strict because the target is: this tab holds the only copy of the IR code
 * library, the only `findTimeout`/`tuyaVersion` for two devices, and the uninstalled Outside Temp's
 * whole path — none of which the repository can restore.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  planAircon,
  validateAirconPlan,
  POLL_INJECT_ID,
  POLL_GATE_ID,
  LEGACY_ACU_OK_ID,
} from '../node-red-bridge/airconFlowPlan.mjs';
import { extractIrLibrary, HUB_POLL_INTERVAL_S, AIRCON_MARKER } from '../node-red-bridge/airconSources.mjs';

const LIVE_TAB = JSON.parse(readFileSync(new URL('./fixtures/aircon-tab-live-2026-09-17.json', import.meta.url), 'utf8'));

/** The live tab plus a neighbouring tab, so "nothing else is touched" is actually tested. */
const liveFlow = () => [
  ...structuredClone(LIVE_TAB),
  { id: 'otherTab', type: 'tab', label: 'Switch' },
  { id: 'lightHub', type: 'function', z: 'otherTab', name: 'Lighting Logic Hub', func: 'return msg;', outputs: 1, wires: [[]] },
];

const byName = (flows, name) => flows.find((n) => n.name === name || n.deviceName === name);
const byId = (flows, id) => flows.find((n) => n.id === id);

test('the live tab plans cleanly and passes its own invariants', () => {
  const before = liveFlow();
  const plan = planAircon(before);
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(validateAirconPlan(before, plan.flows, plan), []);
});

test('exactly the planned nodes change, one is removed and two are added', () => {
  const before = liveFlow();
  const plan = planAircon(before);
  const changedNames = plan.changes.map((c) => c.name).sort();
  assert.deepEqual(changedNames, [
    'AC Master Logic', 'ACU auth + validate', 'Check Time AC', 'Cron AC', 'Dashboard State Manager',
    'ESP32 AC Sniffer', 'Get Sched AC', 'IR hub parser', 'Load on Refresh', 'NBRIC IR Blaster',
  ].sort());
  assert.deepEqual(plan.removed, [LEGACY_ACU_OK_ID]);
  assert.deepEqual(plan.added.sort(), [POLL_GATE_ID, POLL_INJECT_ID].sort());
});

test('the blaster is un-quiesced and nothing else about it changes', () => {
  const before = liveFlow();
  const { flows } = planAircon(before);
  const was = byName(before, 'NBRIC IR Blaster');
  const now = byName(flows, 'NBRIC IR Blaster');
  assert.equal(was.disableAutoStart, true);
  assert.equal(now.disableAutoStart, false);
  assert.deepEqual({ ...now, disableAutoStart: true }, was);
});

test('--keep-quiesced leaves the blaster exactly as it is', () => {
  const before = liveFlow();
  const { flows } = planAircon(before, { enableHub: false });
  assert.deepEqual(byName(flows, 'NBRIC IR Blaster'), byName(before, 'NBRIC IR Blaster'));
});

test('the uninstalled Outside Temp and its parser are byte-identical and stay quiesced', () => {
  const before = liveFlow();
  const { flows } = planAircon(before);
  for (const name of ['Outside Temp', 'Extract DP 103']) {
    assert.deepEqual(byName(flows, name), byName(before, name), `${name} changed`);
  }
  assert.equal(byName(flows, 'Outside Temp').disableAutoStart, true);
});

test('the discovery back-off, stale-address recovery and the bridge collector are untouched', () => {
  const before = liveFlow();
  const { flows } = planAircon(before);
  for (const name of ['Discovery back-off', 'Stale address recovery', 'Bridge collect: Aircon', 'AREC ACU Daily Parser', 'Load UI on Refresh']) {
    assert.deepEqual(byName(flows, name), byName(before, name), `${name} changed`);
  }
});

test('the IR code library survives regeneration byte for byte', () => {
  const before = liveFlow();
  const { flows } = planAircon(before);
  assert.deepEqual(extractIrLibrary(byName(flows, 'AC Master Logic').func), extractIrLibrary(byName(before, 'AC Master Logic').func));
});

test('/acu replies from AC Master Logic, after it knows what happened — not in parallel', () => {
  const { flows } = planAircon(liveFlow());
  const master = byName(flows, 'AC Master Logic');
  const auth = byId(flows, 'bems_acu_auth');
  assert.deepEqual(auth.wires, [[master.id], ['bems_acu_reply']]);
  assert.equal(master.outputs, 3);
  assert.deepEqual(master.wires, [[byName(flows, 'NBRIC IR Blaster').id], [byName(flows, 'Dashboard State Manager').id], ['bems_acu_reply']]);
  assert.equal(byId(flows, LEGACY_ACU_OK_ID), undefined);
  assert.equal(flows.some((n) => (n.wires ?? []).flat().includes(LEGACY_ACU_OK_ID)), false, 'something still wires to the removed node');
});

test('the parser is the generated hub parser, feeding the state manager on both outputs', () => {
  const { flows } = planAircon(liveFlow());
  const parser = byName(flows, 'IR hub parser');
  assert.ok(parser.func.includes(AIRCON_MARKER));
  assert.deepEqual(parser.wires, [[byName(flows, 'Dashboard State Manager').id], [byName(flows, 'Dashboard State Manager').id]]);
  assert.equal(byName(flows, 'NBRIC IR Blaster').wires[0][0], parser.id, 'the parser kept its id, so the blaster still feeds it');
});

test('the legacy cron path and the ESP32 sniffer are disabled, not deleted', () => {
  const before = liveFlow();
  const { flows } = planAircon(before);
  for (const name of ['Cron AC', 'Check Time AC', 'Get Sched AC', 'Load on Refresh', 'ESP32 AC Sniffer']) {
    const now = byName(flows, name);
    assert.equal(now.d, true, `${name} not disabled`);
    const { d, ...rest } = now;
    assert.deepEqual(rest, byName(before, name), `${name} changed beyond being disabled`);
  }
});

test('the hub is polled every HUB_POLL_INTERVAL_S through the gate', () => {
  const { flows } = planAircon(liveFlow());
  const inject = byId(flows, POLL_INJECT_ID);
  const gate = byId(flows, POLL_GATE_ID);
  assert.equal(inject.repeat, String(HUB_POLL_INTERVAL_S));
  assert.deepEqual(inject.wires, [[POLL_GATE_ID]]);
  assert.deepEqual(gate.wires, [[byName(flows, 'NBRIC IR Blaster').id]]);
  assert.equal(inject.z, byName(flows, 'NBRIC IR Blaster').z);
});

test('the other tab is untouched', () => {
  const before = liveFlow();
  const { flows } = planAircon(before);
  assert.deepEqual(byId(flows, 'lightHub'), byId(before, 'lightHub'));
});

test('re-running is a no-op', () => {
  const once = planAircon(liveFlow());
  const twice = planAircon(once.flows);
  assert.deepEqual(twice.problems, []);
  assert.deepEqual([twice.changes, twice.added, twice.removed], [[], [], []]);
  assert.deepEqual(twice.flows, once.flows);
});

// --- refusals ---------------------------------------------------------------------------------

test('refuses a flow with no blaster node', () => {
  const flows = liveFlow().filter((n) => n.deviceName !== 'NBRIC IR Blaster');
  assert.match(planAircon(flows).problems.join(' '), /NBRIC IR Blaster/);
});

test('refuses when the IR library cannot be read, rather than regenerating without it', () => {
  // Still a sender (it names send_ir), but its head and library are gone.
  const flows = liveFlow().map((n) => (n.name === 'AC Master Logic' ? { ...n, func: 'msg.payload = { dps: 201, set: "send_ir" }; return msg;' } : n));
  assert.match(planAircon(flows).problems.join(' '), /library/i);
});

test('refuses when the /acu endpoint does not exist yet', () => {
  const flows = liveFlow().filter((n) => n.id !== 'bems_acu_auth');
  assert.match(planAircon(flows).problems.join(' '), /add-endpoints/);
});

test('the invariants catch a changed protocol version on the blaster', () => {
  const before = liveFlow();
  const plan = planAircon(before);
  const tampered = plan.flows.map((n) => (n.deviceName === 'NBRIC IR Blaster' ? { ...n, tuyaVersion: '3.5' } : n));
  assert.match(validateAirconPlan(before, tampered, plan).join(' '), /NBRIC IR Blaster/);
});

test('the invariants catch Outside Temp being woken', () => {
  const before = liveFlow();
  const plan = planAircon(before);
  const tampered = plan.flows.map((n) => (n.deviceName === 'Outside Temp' ? { ...n, disableAutoStart: false } : n));
  assert.match(validateAirconPlan(before, tampered, plan).join(' '), /Outside Temp/);
});

test('the invariants catch a node outside the plan being changed or removed', () => {
  const before = liveFlow();
  const plan = planAircon(before);
  const changed = plan.flows.map((n) => (n.id === 'lightHub' ? { ...n, func: 'msg.payload = 1; return msg;' } : n));
  assert.match(validateAirconPlan(before, changed, plan).join(' '), /Lighting Logic Hub/);
  const removed = plan.flows.filter((n) => n.name !== 'Extract DP 103');
  assert.match(validateAirconPlan(before, removed, plan).join(' '), /removed/);
});

test('the invariants catch a regenerated library that lost a code', () => {
  const before = liveFlow();
  const plan = planAircon(before);
  const tampered = plan.flows.map((n) => (n.name === 'AC Master Logic' ? { ...n, func: n.func.replace(/"30": "[^"]+",?/, '') } : n));
  assert.match(validateAirconPlan(before, tampered, plan).join(' '), /library/i);
});
