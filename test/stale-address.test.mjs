/**
 * Recovery from a cached device address that has stopped existing — FI-025.
 *
 * WHY, measured 2026-09-03. After the access point renumbered its LAN (RM-046), two tuya nodes
 * produced **325 and 323 `EHOSTUNREACH`** in 3.6 h against leases that had been valid that
 * morning, while devices in the ordinary not-found state produced far fewer. The asymmetry is the
 * clue, and the mechanism is in `tuyapi@7.7.1` `index.js:996-1002`:
 *
 *     find({timeout = 10, all = false} = {}) {
 *       if (isValidString(this.device.id) && isValidString(this.device.ip)) {
 *         // Don't need to do anything
 *         return Promise.resolve(true);
 *
 * Once a `find()` has succeeded, the resolved address is cached ON THE INSTANCE, and every later
 * `find()` returns instantly without broadcasting. So the node's retry loop becomes
 * find (no-op) -> connect -> EHOSTUNREACH -> find (no-op), gated only by `retryTimeout` and not
 * by `findTimeout` at all — which is why these two spun roughly four times faster than the rest.
 * `find()` is the only thing that can discover a new address, and a node in this state never
 * really calls it.
 *
 * THE FIX is to make the node build a new `TuyaDevice`. `CONTROL`/`RECONNECT` does not do that —
 * it reuses the instance, cache and all. `CONTROL`/`CONNECT` does: the vendor node's handler runs
 * `initTuya()`, which is `tuyaDevice = new TuyaDevice(connectionParams)`, and `connectionParams.ip`
 * is `node.deviceIp` — empty on every node in this fleet. A fresh instance broadcasts.
 *
 * SELF-LIMITING BY CONSTRUCTION, which is what makes it safe to arm: after a recovery the node
 * really does broadcast, so if the device is genuinely absent the next error is a find timeout
 * rather than an unreachable — and that resets the streak. A device that is gone gets exactly one
 * recovery attempt, not a loop of them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  planStaleAddress, validateStaleAddress, runStaleAddress, staleAddressFnFor,
  UNREACHABLE_MARKERS, UNREACHABLE_STREAK, RECOVERY_COOLDOWN_MS,
  CATCH_ID_PREFIX, FN_ID_PREFIX,
} from '../node-red-bridge/staleAddressPlan.mjs';

/**
 * An error message EXACTLY as Node-RED's runtime builds it — `@node-red/runtime/lib/flows/Flow.js`,
 * `handleError`:
 *
 *     errorMessage.error = { message: logMessage.toString(), source: { id, type, name, count } };
 *
 * Written out rather than assumed. The sibling feature EX-160 shipped to live hardware and
 * changed nothing because its harness invented `msg.source` where the runtime uses
 * `msg.status.source`, and the tests agreed with the author instead of with Node-RED.
 */
const errMsg = (id, message) => ({
  error: { message, source: { id, type: 'tuya-smart-device', name: id, count: 1 } },
});

/** The real text, copied from the Pi's journal. */
const UNREACHABLE = 'Error: Error from socket: connect EHOSTUNREACH 10.0.0.5:6668';
const NOT_FOUND = 'find() timed out. Is the device powered on and the ID or IP correct?';

const drive = (store, ids, id, message, now) => runStaleAddress(store, ids, errMsg(id, message), now);
const sent = (outs) => outs.find((m) => m !== null) ?? null;

const flow = () => [
  { id: 'outlet', type: 'tab', label: 'Outlet' },
  { id: 'o1', type: 'tuya-smart-device', z: 'outlet', deviceName: 'CO1', retryTimeout: '1000', findTimeout: '10000', tuyaVersion: '3.4', wires: [['q1'], []] },
  { id: 'o2', type: 'tuya-smart-device', z: 'outlet', deviceName: 'CO2', retryTimeout: '1000', findTimeout: '10000', tuyaVersion: '3.4', wires: [['q1'], []] },
  { id: 'q1', type: 'function', z: 'outlet', name: 'Outlet 1 Unified Parser', wires: [[]] },
  { id: 'other', type: 'inject', z: 'outlet', name: 'unrelated', wires: [[]] },
];

// --- the recovery -----------------------------------------------------------------------------

test('one unreachable error is not enough — a single blip must not restart a device', () => {
  const store = {}, ids = ['o1'];
  assert.equal(sent(drive(store, ids, 'o1', UNREACHABLE, 1000)), null);
});

test('a streak of unreachable errors forces a fresh find, as DISCONNECT then CONNECT', () => {
  const store = {}, ids = ['o1'];
  let out = null;
  for (let i = 0; i < UNREACHABLE_STREAK; i++) out = drive(store, ids, 'o1', UNREACHABLE, 1000 + i);
  const msgs = out[0];
  assert.ok(Array.isArray(msgs), 'both control messages go to the one output, in order');
  assert.deepEqual(msgs.map((m) => m.payload.action), ['DISCONNECT', 'CONNECT']);
  assert.deepEqual(msgs.map((m) => m.payload.operation), ['CONTROL', 'CONTROL']);
});

test('DISCONNECT comes first, because CONNECT alone would leave two find timers pending', () => {
  // closeComm() clears the pending find timer; startComm() then sets its own. Reversing these
  // leaves the old timer live against the new TuyaDevice and doubles the loop.
  const store = {}, ids = ['o1'];
  let out = null;
  for (let i = 0; i < UNREACHABLE_STREAK; i++) out = drive(store, ids, 'o1', UNREACHABLE, 1000 + i);
  assert.equal(out[0][0].payload.action, 'DISCONNECT');
});

test('the recovery goes only to the device it is about', () => {
  const store = {}, ids = ['o1', 'o2'];
  let out = null;
  for (let i = 0; i < UNREACHABLE_STREAK; i++) out = drive(store, ids, 'o2', UNREACHABLE, 1000 + i);
  assert.equal(out[0], null);
  assert.ok(Array.isArray(out[1]));
});

test('a find timeout resets the streak, because it proves the node is broadcasting again', () => {
  // This is what makes a genuinely absent device get ONE recovery rather than a loop of them.
  const store = {}, ids = ['o1'];
  for (let i = 0; i < UNREACHABLE_STREAK - 1; i++) drive(store, ids, 'o1', UNREACHABLE, 1000 + i);
  drive(store, ids, 'o1', NOT_FOUND, 2000);
  assert.equal(sent(drive(store, ids, 'o1', UNREACHABLE, 3000)), null, 'the streak must have restarted');
});

test('a second recovery inside the cooldown is refused', () => {
  const store = {}, ids = ['o1'];
  for (let i = 0; i < UNREACHABLE_STREAK; i++) drive(store, ids, 'o1', UNREACHABLE, 1000 + i);
  for (let i = 0; i < UNREACHABLE_STREAK * 3; i++) {
    assert.equal(sent(drive(store, ids, 'o1', UNREACHABLE, 2000 + i)), null);
  }
});

test('after the cooldown a new streak may recover again', () => {
  const store = {}, ids = ['o1'];
  const t0 = 1_000_000;
  for (let i = 0; i < UNREACHABLE_STREAK; i++) drive(store, ids, 'o1', UNREACHABLE, t0 + i);
  const later = t0 + RECOVERY_COOLDOWN_MS + 1;
  let out = null;
  for (let i = 0; i < UNREACHABLE_STREAK; i++) out = drive(store, ids, 'o1', UNREACHABLE, later + i);
  assert.ok(Array.isArray(out[0]), 'a device still stuck after the cooldown gets another attempt');
});

test('every declared unreachable marker is recognised in real log text', () => {
  for (const marker of UNREACHABLE_MARKERS) {
    const store = {}, ids = ['o1'];
    let out = null;
    for (let i = 0; i < UNREACHABLE_STREAK; i++) {
      out = drive(store, ids, 'o1', `Error: Error from socket: connect ${marker} 10.0.0.5:6668`, 1000 + i);
    }
    assert.ok(Array.isArray(out[0]), `${marker} must trigger a recovery`);
  }
});

test('an error that is not about reachability never triggers a restart', () => {
  const store = {}, ids = ['o1'];
  for (let i = 0; i < 20; i++) {
    assert.equal(sent(drive(store, ids, 'o1', 'Error from tuyaDevice. shouldTryReconnect = true, error = {}', 1000 + i)), null);
  }
});

test('the reporting node is read from msg.error.source.id, which is where the runtime puts it', () => {
  // Pinned. `@node-red/runtime/lib/flows/Flow.js` handleError:
  //   errorMessage.error = { message, source: { id, type, name, count } }
  const store = {}, ids = ['o1'];
  let out = null;
  for (let i = 0; i < UNREACHABLE_STREAK; i++) {
    out = runStaleAddress(store, ids, { error: { message: UNREACHABLE, source: { id: 'o1' } } }, 1000 + i);
  }
  assert.ok(Array.isArray(out[0]));
});

test('a message with no identifiable source does nothing and records no state', () => {
  const store = {}, ids = ['o1'];
  const out = runStaleAddress(store, ids, { error: { message: UNREACHABLE } }, 1000);
  assert.deepEqual(out, [null]);
  assert.equal(store.stale, undefined);
});

test('a status from a node this controller does not own sends nothing', () => {
  const store = {}, ids = ['o1'];
  for (let i = 0; i < 10; i++) assert.equal(sent(drive(store, ids, 'stranger', UNREACHABLE, 1000 + i)), null);
});

test('a malformed message is survived rather than thrown on', () => {
  // A throw here would re-enter handleError and, at ten, trip Node-RED's error-loop guard.
  const store = {}, ids = ['o1'];
  assert.doesNotThrow(() => runStaleAddress(store, ids, {}, 1));
  assert.doesNotThrow(() => runStaleAddress(store, ids, { error: {} }, 1));
  assert.doesNotThrow(() => runStaleAddress(store, ids, { error: { source: {} } }, 1));
});

// --- the flow plan ----------------------------------------------------------------------------

test('a catch node and controller are added per tab, scoped to the tuya nodes', () => {
  const before = flow();
  const { flows, added } = planStaleAddress(before);
  assert.equal(added.length, 2);
  const c = flows.find((n) => n.id === CATCH_ID_PREFIX + 'outlet');
  assert.equal(c.type, 'catch');
  assert.deepEqual([...c.scope].sort(), ['o1', 'o2']);
  assert.equal(c.uncaught, false, 'these errors ARE handled by the node; uncaught would miss them');
  const fn = flows.find((n) => n.id === FN_ID_PREFIX + 'outlet');
  assert.equal(fn.outputs, 2);
  assert.deepEqual(fn.wires, [['o1'], ['o2']]);
});

test('NO existing node is modified — least of all a tuya node', () => {
  const before = flow();
  const { flows } = planStaleAddress(before);
  assert.deepEqual(validateStaleAddress(before, flows), []);
  for (const n of before) assert.deepEqual(flows.find((x) => x.id === n.id), n);
});

test('the declared retry and find timeouts are untouched', () => {
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
  const grown = [...once, { id: 'o3', type: 'tuya-smart-device', z: 'outlet', deviceName: 'CO3', wires: [[], []] }];
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
  const src = staleAddressFnFor(['o1']);
  assert.match(src, /DISCONNECT/);
  assert.match(src, /CONNECT/);
  assert.ok(src.includes(JSON.stringify(UNREACHABLE_MARKERS)));
});
