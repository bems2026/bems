/**
 * FI-022's local capability route, planned and validated before it is ever written.
 *
 * This adds nodes to a HAND-BUILT tab and wires them into real devices, which is a different
 * class of change from everything `build-flow.mjs` does — so the plan is checked the way
 * `dpParserPlan`'s is: by executing the generated source, and by asserting the invariant that
 * makes the write safe rather than by trusting the diff.
 *
 * THE INVARIANT: every pre-existing node is byte-identical afterwards. The new router names three
 * tuya nodes in its `wires`, but a node's inputs are not part of it, so nothing the building
 * already depends on is rerouted, disconnected or altered.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  capabilityTargets, planCapabilityRoute, applyCapabilityRoute, validateCapabilityRoute,
  authSrc, NODE_IDS, ROUTED_CLASS,
} from '../node-red-bridge/capabilityRoutePlan.mjs';
import { DEVICE_REGISTRY } from '../shared/registry.mjs';

const TAB = 'energy-tab';

/** A flow shaped like the live one: parsers keyed by the context they write, fed by tuya nodes. */
function fakeFlows({ arecName = 'AREC ACU' } = {}) {
  const parser = (id, ctx, z = TAB) => ({ id, type: 'function', z, name: `${ctx} parser`, func: `flow.set("${ctx}_health", 1);` });
  const tuya = (id, deviceName, wires) => ({ id, type: 'tuya-smart-device', z: TAB, deviceName, wires: [wires] });
  return [
    { id: TAB, type: 'tab', label: 'Energy Monitoring - Set time' },
    parser('p_co', 'co_yel'), parser('p_lo', 'lo_yel2'), parser('p_red', 'lo_red'), parser('p_arec', 'arec'),
    // One physical instrument feeds BOTH channel parsers — the live shape.
    tuya('t_yellow', 'C.O yellow', ['p_co', 'p_lo']),
    tuya('t_red', 'L.O red', ['p_red']),
    tuya('t_arec', arecName, ['p_arec']),
  ];
}

// ---------------------------------------------------------------------------
// Resolving a device to its node. The part that could silently target the wrong meter.
// ---------------------------------------------------------------------------

test('every meter resolves to a node, and only meters do', () => {
  const { targets, warnings } = capabilityTargets(fakeFlows(), DEVICE_REGISTRY);
  assert.deepEqual(Object.keys(targets).sort(), ['mtr_arec_acu', 'mtr_co_yellow', 'mtr_lo_red', 'mtr_lo_yellow']);
  assert.deepEqual(warnings, []);
  // A relay device must never acquire a capability route from this planner.
  for (const d of DEVICE_REGISTRY.filter((x) => x.class !== ROUTED_CLASS)) {
    assert.equal(targets[d.id], undefined, `${d.id} (${d.class}) must not be routed`);
  }
});

test('two channels of one instrument share a node and differ only by dp', () => {
  // THE ONE THAT MATTERS. Getting this wrong sets the alarm threshold on the neighbouring
  // branch circuit — the hazard `capabilityForDevice`'s own header describes.
  const { targets } = capabilityTargets(fakeFlows(), DEVICE_REGISTRY);
  assert.equal(targets.mtr_co_yellow.route, targets.mtr_lo_yellow.route, 'same physical device');
  assert.equal(targets.mtr_co_yellow.caps.warn_power.dp, 111);
  assert.equal(targets.mtr_lo_yellow.caps.warn_power.dp, 121, 'channel 2 takes its own register');
});

test('the node is found by WIRING, not by name', () => {
  // The live flow calls one meter's node "AREC ACU" while the registry calls that device
  // "CARE ACU". Name matching would have mis-targeted it and nothing would have said so.
  const renamed = capabilityTargets(fakeFlows({ arecName: 'something else entirely' }), DEVICE_REGISTRY);
  assert.equal(renamed.targets.mtr_arec_acu.route, 't_arec', 'still resolved, whatever it is called');
  assert.deepEqual(renamed.warnings, []);
});

test('a device whose parser nothing feeds is refused, not guessed at', () => {
  const flows = fakeFlows().filter((n) => n.id !== 't_red');
  const { targets, warnings } = capabilityTargets(flows, DEVICE_REGISTRY);
  assert.equal(targets.mtr_lo_red, undefined);
  assert.match(warnings.join(' '), /mtr_lo_red/);
});

test('a device fed by two instruments is refused rather than picking one', () => {
  const flows = [...fakeFlows(), { id: 't_extra', type: 'tuya-smart-device', z: TAB, deviceName: 'Impostor', wires: [['p_red']] }];
  const { targets, warnings } = capabilityTargets(flows, DEVICE_REGISTRY);
  assert.equal(targets.mtr_lo_red, undefined);
  assert.match(warnings.join(' '), /expected exactly 1/);
});

// ---------------------------------------------------------------------------
// The generated node, executed.
// ---------------------------------------------------------------------------

const run = (src, msg, token = 'tok') =>
  new Function('env', 'msg', src)({ get: () => token }, msg);
const req = (deviceId, body, headers = { 'x-auth-token': 'tok' }) =>
  ({ req: { params: { deviceId }, headers }, payload: body });

function authFor() {
  const { targets } = capabilityTargets(fakeFlows(), DEVICE_REGISTRY);
  return authSrc(targets);
}

test('a valid write becomes the one message shape a tuya node takes', () => {
  const [dev, reply] = run(authFor(), req('mtr_co_yellow', { capability: 'warn_power', value: 1500 }));
  assert.equal(reply.statusCode, 200);
  const ok = dev;
  assert.deepEqual(ok.payload, { dps: 111, set: 1500 });
  assert.equal(ok.topic, 't_yellow');
});

test('channel 2 writes its own register through the same node', () => {
  const [ok] = run(authFor(), req('mtr_lo_yellow', { capability: 'warn_power', value: 900 }));
  assert.deepEqual(ok.payload, { dps: 121, set: 900 });
  assert.equal(ok.topic, 't_yellow', 'same instrument');
});

test('a bad token is refused before anything is resolved', () => {
  const [dev, reply, err] = run(authFor(), req('mtr_co_yellow', { capability: 'warn_power', value: 1500 }, { 'x-auth-token': 'wrong' }));
  assert.equal(dev, null);
  assert.equal(reply, null);
  assert.equal(err.statusCode, 401);
});

test('a device with no local route is a 404, so the caller can fall back to the cloud', () => {
  // `dispatchLight` tries local first and falls back on failure. A 404 says "not here", which is
  // exactly what should send an outlet's countdown to the vendor rather than failing the write.
  const [, , err] = run(authFor(), req('co5', { capability: 'countdown_1', value: 60 }));
  assert.equal(err.statusCode, 404);
});

test('a capability the catalogue does not mark writable is refused', () => {
  const [, , err] = run(authFor(), req('mtr_co_yellow', { capability: 'cur_power', value: 5 }));
  assert.equal(err.statusCode, 400);
  assert.match(err.payload.error, /not writable/);
});

test('the vendor bounds are enforced here, not just in the UI', () => {
  // warn_power is declared 200..50000. A slider is not the only caller, and a value the device
  // would silently reject is worse than one refused with a reason.
  for (const value of [199, 50001]) {
    const [, , err] = run(authFor(), req('mtr_co_yellow', { capability: 'warn_power', value }));
    assert.equal(err.statusCode, 400, `${value} refused`);
  }
  for (const value of [200, 50000]) {
    const [ok] = run(authFor(), req('mtr_co_yellow', { capability: 'warn_power', value }));
    assert.ok(ok, `${value} accepted at the boundary`);
  }
});

test('a non-numeric value is refused rather than coerced', () => {
  for (const value of ['1500', null, true, NaN]) {
    const [, , err] = run(authFor(), req('mtr_co_yellow', { capability: 'warn_power', value }));
    assert.equal(err.statusCode, 400, JSON.stringify(value));
  }
});

test('an enum value outside the declared range is refused', () => {
  const [, , err] = run(authFor(), req('mtr_co_yellow', { capability: 'sync_response', value: 'nonsense' }));
  assert.equal(err.statusCode, 400);
});

// ---------------------------------------------------------------------------
// Applying, and the invariant that makes it safe.
// ---------------------------------------------------------------------------

test('applying adds only this planner\'s nodes and modifies nothing', () => {
  const before = fakeFlows();
  const plan = planCapabilityRoute(before, { registry: DEVICE_REGISTRY, tabId: TAB });
  const after = applyCapabilityRoute(before, plan);
  assert.deepEqual(validateCapabilityRoute(before, after, plan), []);
  assert.equal(after.length, before.length + plan.nodes.length);
});

test('every pre-existing node is byte-identical afterwards', () => {
  const before = fakeFlows();
  const plan = planCapabilityRoute(before, { registry: DEVICE_REGISTRY, tabId: TAB });
  const after = applyCapabilityRoute(before, plan);
  for (const node of before) {
    const now = after.find((n) => n.id === node.id);
    assert.equal(JSON.stringify(now), JSON.stringify(node), `${node.id} unchanged`);
  }
});

test('applying twice replaces rather than duplicates', () => {
  const before = fakeFlows();
  const plan = planCapabilityRoute(before, { registry: DEVICE_REGISTRY, tabId: TAB });
  const once = applyCapabilityRoute(before, plan);
  const twice = applyCapabilityRoute(once, planCapabilityRoute(once, { registry: DEVICE_REGISTRY, tabId: TAB }));
  assert.equal(twice.length, once.length);
  for (const id of Object.values(NODE_IDS)) {
    assert.equal(twice.filter((n) => n.id === id).length, 1, `${id} appears once`);
  }
});

test('the validator catches a modified existing node', () => {
  const before = fakeFlows();
  const plan = planCapabilityRoute(before, { registry: DEVICE_REGISTRY, tabId: TAB });
  const after = applyCapabilityRoute(before, plan).map((n) =>
    n.id === 't_red' ? { ...n, wires: [[]] } : n);
  assert.match(validateCapabilityRoute(before, after, plan).join(' '), /t_red was modified/);
});

test('the validator catches a removed node', () => {
  const before = fakeFlows();
  const plan = planCapabilityRoute(before, { registry: DEVICE_REGISTRY, tabId: TAB });
  const after = applyCapabilityRoute(before, plan).filter((n) => n.id !== 'p_red');
  assert.match(validateCapabilityRoute(before, after, plan).join(' '), /p_red was removed/);
});

test('the validator refuses a route target that is not a device', () => {
  const before = fakeFlows();
  const plan = planCapabilityRoute(before, { registry: DEVICE_REGISTRY, tabId: TAB });
  const bent = { ...plan, routes: ['p_red'] };
  assert.match(validateCapabilityRoute(before, applyCapabilityRoute(before, plan), bent).join(' '), /not a device/);
});

test('the router wires only to tuya nodes that already exist', () => {
  const before = fakeFlows();
  const plan = planCapabilityRoute(before, { registry: DEVICE_REGISTRY, tabId: TAB });
  const router = plan.nodes.find((n) => n.id === NODE_IDS.router);
  const targets = router.wires.flat();
  assert.equal(targets.length, 3, 'three instruments back four logical meters');
  for (const t of targets) {
    assert.equal(before.find((n) => n.id === t)?.type, 'tuya-smart-device', t);
  }
});

test('a flow with no meters gets no endpoint at all', () => {
  // Better than an endpoint that always 404s: nothing is added to a site this cannot serve.
  const plan = planCapabilityRoute([{ id: TAB, type: 'tab' }], { registry: DEVICE_REGISTRY, tabId: TAB });
  assert.deepEqual(plan.nodes, []);
});

test('the node accepts the channel code the proxy actually sends, and the base', () => {
  // CAUGHT BY THE PROXY INTEGRATION TEST, not by reasoning. `server/proxy.mjs` resolves a write
  // to the device's own code — `warn_power1` — before dispatching, while the catalogue and the
  // frontend talk in bases. A table keyed by only one of them makes every real write fail with
  // "not writable", and the 400 would have looked like a validation problem rather than a
  // vocabulary mismatch.
  const src = authFor();
  const byCode = run(src, req('mtr_co_yellow', { capability: 'warn_power1', value: 1500 }));
  const byBase = run(src, req('mtr_co_yellow', { capability: 'warn_power', value: 1500 }));
  assert.deepEqual(byCode[0].payload, { dps: 111, set: 1500 });
  assert.deepEqual(byBase[0].payload, { dps: 111, set: 1500 });
});

test('channel 2 accepts ITS code and not the other channel’s', () => {
  const src = authFor();
  assert.deepEqual(run(src, req('mtr_lo_yellow', { capability: 'warn_power2', value: 900 }))[0].payload, { dps: 121, set: 900 });
  // `warn_power1` is not a capability of this logical device — accepting it would write the
  // neighbouring branch circuit's threshold through the shared instrument.
  assert.equal(run(src, req('mtr_lo_yellow', { capability: 'warn_power1', value: 900 }))[2].statusCode, 400);
});

test('the DEVICE branch carries nothing but topic and payload', () => {
  // MEASURED ON THE LIVE METER 2026-09-08, and the reason this is asserted rather than assumed:
  // forwarding the http-in message to a tuya node makes it log
  // "Converting circular structure to JSON" and drop the write, while the endpoint still answers
  // HTTP 200. The caller sees success and the register never moves — the exact failure this
  // project's own deploy notes warn about twice over.
  const [dev, reply] = run(authFor(), req('mtr_co_yellow', { capability: 'warn_power', value: 1500 }));
  assert.deepEqual(Object.keys(dev).sort(), ['payload', 'topic']);
  assert.equal(dev.req, undefined, 'no request object');
  assert.equal(dev.res, undefined, 'no response object');
  // ...while the reply keeps what it needs to answer.
  assert.ok(reply.req, 'the reply branch still has the request');
  assert.equal(reply.statusCode, 200);
});

test('the device branch is JSON-serialisable, which is what the tuya node requires', () => {
  const [dev] = run(authFor(), req('mtr_lo_red', { capability: 'warn_power', value: 1500 }));
  assert.doesNotThrow(() => JSON.stringify(dev));
});
