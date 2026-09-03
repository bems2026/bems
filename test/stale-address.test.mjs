/**
 * Recovery from a cached device address that has stopped existing — FI-025.
 *
 * WHY, measured 2026-09-03. After the access point renumbered its LAN (RM-046), two tuya nodes
 * produced **325 and 323 `EHOSTUNREACH`** in 3.6 h against leases that had been valid that
 * morning, while devices in the ordinary not-found state produced far fewer. The mechanism is
 * `tuyapi@7.7.1` `index.js:996-1002`: once `find()` has resolved an address it caches it on the
 * instance and every later `find()` returns instantly without broadcasting. `find()` is the only
 * thing that can discover a NEW address, so such a node can never recover from a DHCP change.
 *
 * HOW IT IS DETECTED. Not from the error text — Node-RED carries none of it, which was
 * established by reading all three candidate paths rather than assuming: the status text is
 * `'Error : ' + JSON.stringify(error)` and stringifying an `Error` gives `{}`; a catch node never
 * sees these because `node.error` only routes to one when passed a second object argument
 * (`Node.js:570`) and the vendor logger passes one argument (`utils.js:27`); the node's status
 * output carries `{state}` only. The FIRST implementation of this feature used a catch node,
 * deployed cleanly to the Pi, raised no error, and received nothing whatsoever.
 *
 * So detection is derived from the mechanism instead: **a find/connect cycle cannot complete
 * faster than `findTimeout` unless `find()` short-circuited.** The threshold is taken per device
 * from that node's own declared `findTimeout`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  planStaleAddress, validateStaleAddress, runStaleAddress, staleAddressFnFor, shortCircuitMsFor,
  SHORTCIRCUIT_STREAK, RECOVERY_COOLDOWN_MS, DEFAULT_FIND_TIMEOUT_MS, SHORTCIRCUIT_FRACTION,
  STATE_KEY, STATUS_ID_PREFIX, FN_ID_PREFIX,
} from '../node-red-bridge/staleAddressPlan.mjs';

/**
 * A status message EXACTLY as Node-RED's runtime builds it — `@node-red/runtime/lib/flows/Flow.js`,
 * `handleStatus`:
 *
 *     message.status.source = { id: node.id, type: node.type, name: node.name }
 *
 * Written out rather than assumed. EX-160 shipped to live hardware and changed nothing because
 * its harness invented `msg.source`, and its tests agreed with the author instead of with Node-RED.
 */
const statusMsg = (id, fill) => ({
  status: { fill, shape: 'ring', text: fill, source: { id, type: 'tuya-smart-device', name: id } },
});

/** One node, findTimeout 10 s, so the short-circuit threshold is 5 s. */
const IDS = ['o1'];
const LIMITS = [5000];

const drive = (store, id, fill, now, ids = IDS, limits = LIMITS) =>
  runStaleAddress(store, ids, limits, statusMsg(id, fill), now);
const sent = (outs) => outs.find((m) => m !== null) ?? null;

/** A full find/connect cycle that FAILED, taking `ms`. Returns the controller's last output. */
function cycle(store, id, ms, t, ids = IDS, limits = LIMITS) {
  drive(store, id, 'yellow', t, ids, limits);
  return drive(store, id, 'red', t + ms, ids, limits);
}

const SHORT = 400;   // a short-circuited find: straight through to a connect that fails fast
const FULL = 10_000; // a real find that broadcast and timed out

const flow = () => [
  { id: 'outlet', type: 'tab', label: 'Outlet' },
  { id: 'o1', type: 'tuya-smart-device', z: 'outlet', deviceName: 'CO1', retryTimeout: '1000', findTimeout: '10000', tuyaVersion: '3.4', wires: [['q1'], []] },
  { id: 'o2', type: 'tuya-smart-device', z: 'outlet', deviceName: 'CO2', retryTimeout: '1000', findTimeout: '10000', tuyaVersion: '3.4', wires: [['q1'], []] },
  { id: 'q1', type: 'function', z: 'outlet', name: 'Outlet 1 Unified Parser', wires: [[]] },
  { id: 'other', type: 'inject', z: 'outlet', name: 'unrelated', wires: [[]] },
];

// --- detection --------------------------------------------------------------------------------

test('a full-length failed cycle is a healthy broadcast and never triggers anything', () => {
  // This is what an absent device looks like. It must be left completely alone, forever.
  const store = {};
  for (let i = 0; i < 30; i++) {
    assert.equal(sent(cycle(store, 'o1', FULL, 100_000 + i * 20_000)), null);
  }
});

test('one short cycle is not enough — a single fast failure must not restart a device', () => {
  const store = {};
  assert.equal(sent(cycle(store, 'o1', SHORT, 100_000)), null);
});

test('a streak of short cycles forces a fresh find, as DISCONNECT then CONNECT', () => {
  const store = {};
  let out = null;
  for (let i = 0; i < SHORTCIRCUIT_STREAK; i++) out = cycle(store, 'o1', SHORT, 100_000 + i * 2000);
  const msgs = out[0];
  assert.ok(Array.isArray(msgs), 'both control messages go to the one output, in order');
  assert.deepEqual(msgs.map((m) => m.payload.action), ['DISCONNECT', 'CONNECT']);
  assert.deepEqual(msgs.map((m) => m.payload.operation), ['CONTROL', 'CONTROL']);
});

test('DISCONNECT comes first, because CONNECT alone would leave two find timers pending', () => {
  const store = {};
  let out = null;
  for (let i = 0; i < SHORTCIRCUIT_STREAK; i++) out = cycle(store, 'o1', SHORT, 100_000 + i * 2000);
  assert.equal(out[0][0].payload.action, 'DISCONNECT');
});

test('a full-length cycle resets the streak, which is what stops an absent device looping', () => {
  // The self-limiting property. After a recovery the node really broadcasts, so its next failure
  // is full length — and that must undo the progress towards another restart.
  const store = {};
  for (let i = 0; i < SHORTCIRCUIT_STREAK - 1; i++) cycle(store, 'o1', SHORT, 100_000 + i * 2000);
  cycle(store, 'o1', FULL, 200_000);
  assert.equal(sent(cycle(store, 'o1', SHORT, 300_000)), null, 'the streak must have restarted');
});

test('a device that connects clears the streak', () => {
  const store = {};
  for (let i = 0; i < SHORTCIRCUIT_STREAK - 1; i++) cycle(store, 'o1', SHORT, 100_000 + i * 2000);
  drive(store, 'o1', 'green', 200_000);
  assert.equal(sent(cycle(store, 'o1', SHORT, 300_000)), null);
});

test('the threshold is the boundary: exactly findTimeout/2 counts as a real find', () => {
  const store = {};
  for (let i = 0; i < SHORTCIRCUIT_STREAK * 3; i++) {
    assert.equal(sent(cycle(store, 'o1', LIMITS[0], 100_000 + i * 20_000)), null);
  }
});

test('a red with no preceding yellow concludes nothing — it neither counts nor clears', () => {
  // A restart, or a status arriving mid-cycle. Guessing a latency from a missing start would be
  // inventing evidence in EITHER direction, so the assertion has to pin both.
  const store = {};
  cycle(store, 'o1', SHORT, 100_000);
  assert.equal(store[STATE_KEY].o1.hits, 1);
  drive(store, 'o1', 'red', 105_000);
  assert.equal(store[STATE_KEY].o1.hits, 1, 'a bare red must not clear the streak either');
});

test('a re-entered connecting does not restart the cycle clock', () => {
  const store = {};
  drive(store, 'o1', 'yellow', 100_000);
  drive(store, 'o1', 'yellow', 109_000);
  drive(store, 'o1', 'red', 110_000);
  // The cycle began at 100_000, so that was a FULL 10 s cycle, not a 1 s one. Asserted on the
  // recorded hit count, not on the output: at one hit the output is null either way, so an
  // output assertion here cannot fail.
  assert.equal(store[STATE_KEY].o1.hits, 0, 'the clock must run from the first yellow');
});

test('a second recovery inside the cooldown is refused', () => {
  const store = {};
  for (let i = 0; i < SHORTCIRCUIT_STREAK; i++) cycle(store, 'o1', SHORT, 100_000 + i * 2000);
  for (let i = 0; i < SHORTCIRCUIT_STREAK * 3; i++) {
    assert.equal(sent(cycle(store, 'o1', SHORT, 110_000 + i * 2000)), null);
  }
});

test('after the cooldown a device still stuck may recover again', () => {
  const store = {};
  const t0 = 1_000_000;
  for (let i = 0; i < SHORTCIRCUIT_STREAK; i++) cycle(store, 'o1', SHORT, t0 + i * 2000);
  const later = t0 + RECOVERY_COOLDOWN_MS + 10_000;
  let out = null;
  for (let i = 0; i < SHORTCIRCUIT_STREAK; i++) out = cycle(store, 'o1', SHORT, later + i * 2000);
  assert.ok(Array.isArray(out[0]));
});

test('devices are tracked independently and the recovery goes only to the right one', () => {
  const ids = ['o1', 'o2'], limits = [5000, 5000];
  const store = {};
  for (let i = 0; i < SHORTCIRCUIT_STREAK - 1; i++) cycle(store, 'o1', SHORT, 100_000 + i * 2000, ids, limits);
  let out = null;
  for (let i = 0; i < SHORTCIRCUIT_STREAK; i++) out = cycle(store, 'o2', SHORT, 200_000 + i * 2000, ids, limits);
  assert.equal(out[0], null, 'o1 must not be restarted');
  assert.ok(Array.isArray(out[1]));
});

test('each device uses its OWN findTimeout, not the first one in the list', () => {
  // o1 declares 10 s (threshold 5 s), o2 declares 30 s (threshold 15 s). An 8 s cycle is a real
  // find for o1 and a SHORT CIRCUIT for o2, so the two must be classified differently. Asserted
  // below the streak so no recovery fires and zeroes the counter — which is what made an earlier
  // version of this test pass against a controller that used one shared threshold.
  const ids = ['o1', 'o2'], limits = [5000, 15000];
  const store = {};
  cycle(store, 'o2', 8000, 100_000, ids, limits);
  cycle(store, 'o2', 8000, 130_000, ids, limits);
  assert.equal(store[STATE_KEY].o2.hits, 2, '8 s is a short circuit against o2 own 15 s threshold');

  cycle(store, 'o1', 8000, 200_000, ids, limits);
  cycle(store, 'o1', 8000, 230_000, ids, limits);
  assert.equal(store[STATE_KEY].o1.hits, 0, 'the same 8 s is a real find against o1 own 5 s threshold');
});

test('the reporting node is read from msg.status.source, which is where the runtime puts it', () => {
  const store = {};
  runStaleAddress(store, IDS, LIMITS, { status: { fill: 'yellow', source: { id: 'o1' } } }, 100_000);
  const out = runStaleAddress(store, IDS, LIMITS, { status: { fill: 'red', source: { id: 'o1' } } }, 100_400);
  assert.deepEqual(out, [null]);
  assert.equal(store[STATE_KEY].o1.hits, 1, 'the cycle must have been counted');
});

test('a message with no identifiable source does nothing and records no state', () => {
  const store = {};
  assert.deepEqual(runStaleAddress(store, IDS, LIMITS, { status: { fill: 'red' } }, 1), [null]);
  assert.equal(store[STATE_KEY], undefined);
});

test('a status from a node this controller does not own is ignored', () => {
  const store = {};
  for (let i = 0; i < 10; i++) cycle(store, 'stranger', SHORT, 100_000 + i * 2000);
  assert.equal(store[STATE_KEY], undefined);
});

test('a malformed message is survived rather than thrown on', () => {
  const store = {};
  assert.doesNotThrow(() => runStaleAddress(store, IDS, LIMITS, {}, 1));
  assert.doesNotThrow(() => runStaleAddress(store, IDS, LIMITS, { status: {} }, 1));
  assert.doesNotThrow(() => runStaleAddress(store, IDS, LIMITS, { status: { source: {} } }, 1));
});

test('state is kept in flow context, so a controller receiving nothing is visible on disk', () => {
  // Not a style preference. The first implementation of this feature deployed cleanly, raised no
  // error, and received nothing — and an empty key on disk is the only reason that was noticed.
  const store = {};
  drive(store, 'o1', 'yellow', 100_000);
  assert.ok(store[STATE_KEY], 'the namespaced flow key must be written');
  assert.match(staleAddressFnFor(IDS, LIMITS), /flow\.set\("bems_stale_recovery"/);
});

// --- thresholds -------------------------------------------------------------------------------

test('the threshold is derived from the declared findTimeout', () => {
  assert.equal(shortCircuitMsFor({ findTimeout: '10000' }), 10000 * SHORTCIRCUIT_FRACTION);
  assert.equal(shortCircuitMsFor({ findTimeout: 30000 }), 30000 * SHORTCIRCUIT_FRACTION);
});

test('an absent or nonsense findTimeout falls back to the vendor default, never to zero', () => {
  // A zero threshold would classify every cycle as a short circuit and restart the whole fleet.
  for (const bad of [{}, { findTimeout: '' }, { findTimeout: 'abc' }, { findTimeout: 0 }, { findTimeout: -5 }]) {
    assert.equal(shortCircuitMsFor(bad), DEFAULT_FIND_TIMEOUT_MS * SHORTCIRCUIT_FRACTION);
  }
});

// --- the flow plan ----------------------------------------------------------------------------

test('a status node and controller are added per tab, scoped to the tuya nodes', () => {
  const before = flow();
  const { flows, added } = planStaleAddress(before);
  assert.equal(added.length, 2);
  const s = flows.find((n) => n.id === STATUS_ID_PREFIX + 'outlet');
  assert.equal(s.type, 'status');
  assert.deepEqual([...s.scope].sort(), ['o1', 'o2']);
  const fn = flows.find((n) => n.id === FN_ID_PREFIX + 'outlet');
  assert.equal(fn.outputs, 2);
  assert.deepEqual(fn.wires, [['o1'], ['o2']]);
  assert.ok(fn.func.includes('[5000,5000]'), 'each device carries its own threshold');
});

test('NO existing node is modified — least of all a tuya node', () => {
  const before = flow();
  const { flows } = planStaleAddress(before);
  assert.deepEqual(validateStaleAddress(before, flows), []);
  for (const n of before) assert.deepEqual(flows.find((x) => x.id === n.id), n);
});

test('the declared timeouts and deviceIp are untouched', () => {
  const { flows } = planStaleAddress(flow());
  for (const n of flows.filter((x) => x.type === 'tuya-smart-device')) {
    assert.equal(n.retryTimeout, '1000');
    assert.equal(n.findTimeout, '10000');
  }
});

test('re-running changes nothing', () => {
  const once = planStaleAddress(flow()).flows;
  const twice = planStaleAddress(once);
  assert.equal(twice.unchanged, true);
  assert.equal(twice.flows.length, once.length);
});

test('an existing controller is upgraded when the device set changes', () => {
  const once = planStaleAddress(flow()).flows;
  const grown = [...once, { id: 'o3', type: 'tuya-smart-device', z: 'outlet', deviceName: 'CO3', findTimeout: '10000', wires: [[], []] }];
  const res = planStaleAddress(grown);
  assert.equal(res.unchanged, false);
  assert.equal(res.flows.length, grown.length, 'an upgrade adds no nodes');
  assert.deepEqual(res.flows.find((n) => n.id === FN_ID_PREFIX + 'outlet').wires, [['o1'], ['o2'], ['o3']]);
});

test('a flow with no tuya nodes is left completely alone', () => {
  const bare = [{ id: 't', type: 'tab', label: 'Empty' }];
  const res = planStaleAddress(bare);
  assert.equal(res.unchanged, true);
  assert.deepEqual(res.flows, bare);
});

test('the validator refuses a plan that touched a tuya node', () => {
  const before = flow();
  const tampered = planStaleAddress(before).flows.map((n) => (n.id === 'o1' ? { ...n, deviceIp: '10.0.0.5' } : n));
  assert.ok(validateStaleAddress(before, tampered).length > 0);
});

test('the emitted source is what these tests ran', () => {
  const src = staleAddressFnFor(IDS, LIMITS);
  assert.match(src, /DISCONNECT/);
  assert.match(src, /CONNECT/);
  assert.ok(src.includes(JSON.stringify(LIMITS)));
});
