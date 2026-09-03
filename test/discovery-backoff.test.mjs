/**
 * Exponential back-off on failed discovery — the item `docs/adr-002-device-recovery-path.md`
 * prescribed ("Back off on failed discovery rather than retrying at a fixed rate forever") and
 * nothing ever built.
 *
 * WHY IT MATTERS, measured 2026-09-03. With fourteen devices off the air after the RM-020 power
 * cycle, every one of them sat in a `find()` -> timeout -> retry loop at a fixed 1 s, producing
 * ~230 journal lines a minute — 12,386 in 3.6 h — and holding the Pi's load average near 3.5.
 * None of that retrying could succeed: `find()` can only locate a device that broadcasts, and a
 * 30 s listen heard three of twenty.
 *
 * The back-off is applied at RUN TIME through the node's own `SET_RETRY_TIMEOUT` control
 * operation, NOT by editing `retryTimeout` in the flow. That is deliberate and load-bearing:
 * `retryTimeout`, `findTimeout` and `tuyaVersion` live only on the hand-built source tabs, are
 * declared nowhere in this repository, and losing them produces no diff and no alarm while making
 * every device read offline (CLAUDE.md). A run-time control message changes none of them, so
 * `findSettingsDrift` and `live-flow-baseline.json` stay valid, and a Node-RED restart returns
 * every node to its declared 1 s — the safe direction to fail.
 *
 * The controller function is EXECUTED here rather than string-matched. A back-off that never
 * resets would leave a returning device unreachable for a minute forever, which is a worse fault
 * than the noise it was written to cure.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  planDiscoveryBackoff, validateDiscoveryBackoff, backoffTabs, tuyaNodesOn,
  runBackoff, backoffFnFor, BASE_RETRY_MS, MAX_RETRY_MS,
  STATUS_ID_PREFIX, FN_ID_PREFIX,
} from '../node-red-bridge/discoveryBackoffPlan.mjs';

const flow = () => [
  { id: 'energy', type: 'tab', label: 'Energy Monitoring - Set time' },
  { id: 'outlet', type: 'tab', label: 'Outlet' },
  { id: 'm1', type: 'tuya-smart-device', z: 'energy', deviceName: 'C.O yellow', retryTimeout: '1000', findTimeout: '10000', tuyaVersion: '3.5', wires: [['p1'], []] },
  { id: 'm2', type: 'tuya-smart-device', z: 'energy', deviceName: 'L.O red', retryTimeout: '1000', findTimeout: '10000', tuyaVersion: '3.5', wires: [['p2'], []] },
  { id: 'p1', type: 'function', z: 'energy', name: 'C.O Yellow Unified Parser', wires: [[]] },
  { id: 'p2', type: 'function', z: 'energy', name: 'L.O Red Unified Parser', wires: [[]] },
  { id: 'o1', type: 'tuya-smart-device', z: 'outlet', deviceName: 'CO1', retryTimeout: '1000', findTimeout: '10000', tuyaVersion: '3.4', wires: [['q1'], []] },
  { id: 'q1', type: 'function', z: 'outlet', name: 'Outlet 1 Unified Parser', wires: [[]] },
  { id: 'other', type: 'inject', z: 'outlet', name: 'unrelated', wires: [[]] },
];

/** Drives the emitted controller source against a fake node context. */
const drive = (store, ids, id, fill) => runBackoff(store, ids, { source: { id }, status: { fill } });
/** The single non-null message a run produced, or null. */
const sent = (outs) => outs.find((m) => m !== null) ?? null;

// --- the back-off itself ---------------------------------------------------------------------

test('the first failure sends nothing, because the node is already at the declared retry', () => {
  // A device that blips once and recovers should cost zero control messages. The schedule's
  // first step IS the declared value, so sending it would be telling the node what it already is.
  const store = {}, ids = ['m1'];
  assert.equal(sent(drive(store, ids, 'm1', 'red')), null);
  assert.equal(sent(drive(store, ids, 'm1', 'green')), null);
});

test('a failing device backs off, doubling each cycle', () => {
  const store = {}, ids = ['m1', 'm2'];
  const seen = [];
  for (let i = 0; i < 4; i++) {
    const m = sent(drive(store, ids, 'm1', 'red'));
    if (m) seen.push(m.payload.value);
  }
  // Cycle 1 is the no-op above; the doubling starts from the second consecutive failure.
  assert.deepEqual(seen, [BASE_RETRY_MS * 2, BASE_RETRY_MS * 4, BASE_RETRY_MS * 8]);
});

test('the back-off caps, and stops re-sending once it is there', () => {
  // Without the "only send on change" guard this would emit the cap on every cycle forever,
  // replacing a loop of find attempts with a loop of control messages.
  const store = {}, ids = ['m1'];
  let last = null, sends = 0;
  for (let i = 0; i < 40; i++) {
    const m = sent(drive(store, ids, 'm1', 'red'));
    if (m) { sends++; last = m.payload.value; }
  }
  assert.equal(last, MAX_RETRY_MS);
  assert.ok(sends < 12, `expected the sends to stop at the cap, got ${sends}`);
});

test('a device that connects is reset to the declared retry immediately', () => {
  // The failure that would matter: a returning device left on a 60 s retry is a device the
  // operator experiences as still broken.
  const store = {}, ids = ['m1'];
  for (let i = 0; i < 20; i++) drive(store, ids, 'm1', 'red');
  const m = sent(drive(store, ids, 'm1', 'green'));
  assert.equal(m.payload.value, BASE_RETRY_MS);
  assert.equal(m.payload.operation, 'CONTROL');
  assert.equal(m.payload.action, 'SET_RETRY_TIMEOUT');
});

test('a healthy device is not sent anything at all', () => {
  const store = {}, ids = ['m1'];
  assert.equal(sent(drive(store, ids, 'm1', 'green')), null);
  assert.equal(sent(drive(store, ids, 'm1', 'green')), null);
});

test('connecting is transitional and carries no verdict, so it is ignored', () => {
  // The node emits yellow between every attempt. Counting it would double the back-off rate and
  // make the schedule depend on an implementation detail of the vendor node.
  const store = {}, ids = ['m1'];
  for (let i = 0; i < 6; i++) drive(store, ids, 'm1', 'yellow');
  // Six yellows then two reds must land on the SECOND step, exactly as two reds alone would.
  assert.equal(sent(drive(store, ids, 'm1', 'red')), null);
  const m = sent(drive(store, ids, 'm1', 'red'));
  assert.equal(m.payload.value, BASE_RETRY_MS * 2, 'yellow must not have advanced the schedule');
});

test('the message goes only to the device it is about', () => {
  const store = {}, ids = ['m1', 'm2'];
  drive(store, ids, 'm2', 'red');
  const outs = drive(store, ids, 'm2', 'red');
  assert.equal(outs.length, 2);
  assert.equal(outs[0], null, 'm1 must not be touched');
  assert.notEqual(outs[1], null);
});

test('devices back off independently', () => {
  const store = {}, ids = ['m1', 'm2'];
  for (let i = 0; i < 5; i++) drive(store, ids, 'm1', 'red');
  assert.equal(store.backoff.m1.applied, BASE_RETRY_MS * 16);
  // m2 starts its own schedule from scratch, unaffected by how far m1 has run.
  assert.equal(sent(drive(store, ids, 'm2', 'red')), null);
  const m = sent(drive(store, ids, 'm2', 'red'));
  assert.equal(m.payload.value, BASE_RETRY_MS * 2);
  assert.equal(store.backoff.m1.applied, BASE_RETRY_MS * 16, 'm1 must be undisturbed');
});

test('a status from a node this controller does not own sends nothing', () => {
  const store = {}, ids = ['m1'];
  assert.equal(sent(drive(store, ids, 'stranger', 'red')), null);
});

test('a malformed status message is survived rather than thrown on', () => {
  const store = {}, ids = ['m1'];
  assert.doesNotThrow(() => runBackoff(store, ids, {}));
  assert.doesNotThrow(() => runBackoff(store, ids, { source: {}, status: {} }));
});

// --- the flow plan ---------------------------------------------------------------------------

test('one controller pair is added per tab that has tuya nodes, and none elsewhere', () => {
  const before = flow();
  const { flows, added } = planDiscoveryBackoff(before);
  assert.deepEqual(backoffTabs(before).sort(), ['energy', 'outlet']);
  assert.equal(added.length, 4, 'a status node and a function node for each of the two tabs');
  for (const z of ['energy', 'outlet']) {
    assert.ok(flows.some((n) => n.id === STATUS_ID_PREFIX + z && n.type === 'status'));
    assert.ok(flows.some((n) => n.id === FN_ID_PREFIX + z && n.type === 'function'));
  }
});

test('the status node watches only the tuya nodes, not the whole tab', () => {
  // Unscoped it would fire on every node on the tab, including this controller's own function —
  // and on the parsers, which change status constantly.
  const { flows } = planDiscoveryBackoff(flow());
  const st = flows.find((n) => n.id === STATUS_ID_PREFIX + 'energy');
  assert.deepEqual([...st.scope].sort(), ['m1', 'm2']);
});

test('the controller wires to the tuya nodes, one output each, in a stable order', () => {
  const { flows } = planDiscoveryBackoff(flow());
  const fn = flows.find((n) => n.id === FN_ID_PREFIX + 'energy');
  assert.equal(fn.outputs, 2);
  assert.deepEqual(fn.wires, [['m1'], ['m2']]);
  assert.deepEqual(planDiscoveryBackoff(flow()).flows.find((n) => n.id === FN_ID_PREFIX + 'energy').wires, fn.wires);
});

test('NO existing node is modified — least of all a tuya node', () => {
  // The whole point of using a run-time control operation. `retryTimeout`, `findTimeout` and
  // `tuyaVersion` live only here and are declared nowhere; a plan that touched them would be
  // reintroducing the exact silent-loss hazard CLAUDE.md documents.
  const before = flow();
  const { flows } = planDiscoveryBackoff(before);
  assert.deepEqual(validateDiscoveryBackoff(before, flows), []);
  for (const n of before) {
    const after = flows.find((x) => x.id === n.id);
    assert.deepEqual(after, n, `${n.id} must be byte-identical`);
  }
});

test('the declared retry and find timeouts are untouched, so drift detection stays valid', () => {
  const { flows } = planDiscoveryBackoff(flow());
  for (const n of tuyaNodesOn(flows, 'energy')) {
    assert.equal(n.retryTimeout, '1000');
    assert.equal(n.findTimeout, '10000');
  }
});

test('re-running changes nothing', () => {
  const once = planDiscoveryBackoff(flow()).flows;
  const twice = planDiscoveryBackoff(once);
  assert.equal(twice.unchanged, true);
  assert.equal(twice.flows.length, once.length);
});

test('an existing controller is upgraded when the device set changes, not left stale', () => {
  const once = planDiscoveryBackoff(flow()).flows;
  const grown = [...once, { id: 'o2', type: 'tuya-smart-device', z: 'outlet', deviceName: 'CO2', wires: [[], []] }];
  const res = planDiscoveryBackoff(grown);
  assert.equal(res.unchanged, false);
  const fn = res.flows.find((n) => n.id === FN_ID_PREFIX + 'outlet');
  assert.equal(fn.outputs, 2);
  assert.deepEqual(fn.wires, [['o1'], ['o2']]);
  assert.equal(res.flows.length, grown.length, 'an upgrade adds no nodes');
});

test('a flow with no tuya nodes is left completely alone', () => {
  const bare = [{ id: 't', type: 'tab', label: 'Empty' }, { id: 'i', type: 'inject', z: 't', wires: [[]] }];
  const res = planDiscoveryBackoff(bare);
  assert.equal(res.unchanged, true);
  assert.deepEqual(res.flows, bare);
});

test('the validator refuses a plan that touched a tuya node', () => {
  const before = flow();
  const tampered = planDiscoveryBackoff(before).flows.map((n) =>
    n.id === 'm1' ? { ...n, retryTimeout: '60000' } : n);
  const problems = validateDiscoveryBackoff(before, tampered);
  assert.ok(problems.length > 0, 'silently editing a declared timeout must be caught');
  assert.match(problems.join(' '), /m1|C\.O yellow/);
});

test('the validator refuses a plan that wires to a node that does not exist', () => {
  const before = flow();
  const broken = planDiscoveryBackoff(before).flows.map((n) =>
    n.id === FN_ID_PREFIX + 'energy' ? { ...n, wires: [['ghost'], ['m2']] } : n);
  assert.ok(validateDiscoveryBackoff(before, broken).some((p) => /ghost/.test(p)));
});

test('the emitted source is what these tests ran', () => {
  const src = backoffFnFor(['m1', 'm2']);
  assert.match(src, /SET_RETRY_TIMEOUT/);
  assert.ok(src.includes(String(MAX_RETRY_MS)));
  assert.ok(src.includes(JSON.stringify(['m1', 'm2'])));
});
