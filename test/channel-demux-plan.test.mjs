/**
 * The demux node for the shared dual-channel meter: what ships is a source string injected into a
 * Node-RED function node, so these tests EXECUTE it (as `arrival-tracker.test.mjs` and
 * `energy-day-base.test.mjs` do) — and the plan that inserts it is checked as a pure function over a
 * flow array, as `outlet-poll.test.mjs` checks the poller.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITY_PROFILES } from '../shared/deviceCapabilities.mjs';
import { BUILT_IN_DEVICES, SITE } from '../shared/registry.mjs';
import {
  DEMUX_NODE_ID_PREFIX,
  demuxNodeSrc,
  planChannelDemux,
  validateChannelDemux,
} from '../node-red-bridge/channelDemuxPlan.mjs';

const P = CAPABILITY_PROFILES.cz_ct_double;
const PAIR = SITE.channel_demux[0];
const CO = BUILT_IN_DEVICES.find((d) => d.id === 'mtr_co_yellow');
const LO = BUILT_IN_DEVICES.find((d) => d.id === 'mtr_lo_yellow');

const run = (src, msg, flow) => new Function('msg', 'flow', src)(msg, flow);
function fakeFlow(initial = {}) {
  const store = { ...initial };
  return {
    get: (k) => store[k],
    set: (k, v) => { store[k] = v; },
    store,
  };
}
const SRC = demuxNodeSrc({ pair: PAIR, devices: [CO, LO], profile: P });

// --- the node's behaviour -----------------------------------------------------------------

test('a status message passes through untouched and writes nothing', () => {
  const flow = fakeFlow();
  const out = run(SRC, { payload: 'CONNECTED' }, flow);
  assert.equal(out.payload, 'CONNECTED');
  assert.deepEqual(Object.keys(flow.store), []);
});

test('with the outlet load on channel 1 the dps pass through unchanged and the map says direct', () => {
  const flow = fakeFlow();
  const out = run(SRC, { payload: { dps: { 105: 7544, 106: 6831, 115: 390, 116: 393 } } }, flow);
  assert.deepEqual(out.payload.dps, { 105: 7544, 106: 6831, 115: 390, 116: 393 });
  assert.equal(flow.store.co_yel_channel_map.assignment, 'direct');
  assert.equal(flow.store.co_yel_channel_map.rule, 'ceiling');
  assert.deepEqual(flow.store.lo_yel2_channel_map, flow.store.co_yel_channel_map, 'both parsers can read the same map');
});

test('with the outlet load on channel 2 the dps are renumbered so each parser reads its own circuit', () => {
  // 2026-09-19 12:00 — channel 1 in monitor, channel 2 carrying 543 W of outlets.
  const flow = fakeFlow();
  const out = run(SRC, { payload: { dps: { 103: 'monitor', 105: 0, 106: 0, 113: 'working', 115: 5433, 116: 4217, 123: 62587550 } } }, flow);
  assert.deepEqual(out.payload.dps, { 113: 'monitor', 115: 0, 116: 0, 103: 'working', 105: 5433, 106: 4217, 123: 62587550 });
  assert.equal(flow.store.co_yel_channel_map.assignment, 'swapped');
});

test('the wrapped `data.dps` shape is renumbered in place of the same shape', () => {
  const flow = fakeFlow();
  const out = run(SRC, { payload: { data: { dps: { 105: 0, 106: 0, 115: 5433, 116: 4217 } } } }, flow);
  assert.deepEqual(out.payload.data.dps, { 115: 0, 116: 0, 105: 5433, 106: 4217 });
  assert.equal(out.payload.dps, undefined);
});

test('a partial message is classified against the raw dps remembered from earlier ones', () => {
  const flow = fakeFlow();
  run(SRC, { payload: { dps: { 103: 'monitor', 105: 0, 106: 0, 115: 5433, 116: 4217 } } }, flow); // swapped, adopted
  // Only channel 2 reports this time. Channel 1 is still idle as far as anyone knows, so the
  // assignment holds and this message is renumbered too.
  const out = run(SRC, { payload: { dps: { 115: 5500, 116: 4300 } } }, flow);
  assert.deepEqual(out.payload.dps, { 105: 5500, 106: 4300 });
  assert.deepEqual(flow.store.co_yel_raw_dp, { 103: 'monitor', 105: 0, 106: 0, 115: 5500, 116: 4300 }, 'raw, never renumbered');
});

test('one contradicting message does not flip the assignment; the second does, and is counted', () => {
  const flow = fakeFlow();
  run(SRC, { payload: { dps: { 105: 7544, 106: 6831, 115: 390, 116: 393 } } }, flow); // direct
  const one = run(SRC, { payload: { dps: { 105: 390, 106: 393, 115: 7544, 116: 6831 } } }, flow);
  assert.deepEqual(one.payload.dps, { 105: 390, 106: 393, 115: 7544, 116: 6831 }, 'still direct after one');
  const two = run(SRC, { payload: { dps: { 105: 390, 106: 393, 115: 7544, 116: 6831 } } }, flow);
  assert.deepEqual(two.payload.dps, { 115: 390, 116: 393, 105: 7544, 106: 6831 });
  assert.equal(flow.store.co_yel_channel_map.assignment, 'swapped');
  assert.equal(flow.store.co_yel_channel_map.flips, 1);
});

test('the map carries when and why, so a reader downstream can show it', () => {
  const flow = fakeFlow();
  const before = Date.now();
  run(SRC, { payload: { dps: { 105: 7544, 106: 6831, 115: 390, 116: 393 } } }, flow);
  const m = flow.store.co_yel_channel_map;
  assert.ok(m.since >= before);
  assert.equal(m.lastRule, 'ceiling');
  run(SRC, { payload: { dps: { 105: 403, 106: 232, 115: 412, 116: 427 } } }, flow); // both ~40 W
  assert.equal(flow.store.co_yel_channel_map.lastRule, 'carry');
  assert.equal(flow.store.co_yel_channel_map.assignment, 'direct');
});

// --- the plan over a flow ----------------------------------------------------------------------

/** The live tab's shape, reduced: one tuya node fanned to two generated parsers on both outputs. */
function liveFlow() {
  return [
    { id: 'tab1', type: 'tab', label: 'Energy Monitoring - Set time' },
    { id: 'tuya1', type: 'tuya-smart-device', z: 'tab1', deviceName: 'C.O yellow', wires: [['pCO', 'pLO'], ['pCO', 'pLO']] },
    { id: 'pCO', type: 'function', z: 'tab1', name: 'C.O Yellow Unified Parser', func: 'flow.set("co_yel_health", true);', wires: [[], []] },
    { id: 'pLO', type: 'function', z: 'tab1', name: 'L.O Yellow Unified Parser', func: 'flow.set("lo_yel2_health", true);', wires: [[], []] },
    { id: 'tuya2', type: 'tuya-smart-device', z: 'tab1', deviceName: 'L.O red', wires: [['pRed'], ['pRed']] },
    { id: 'pRed', type: 'function', z: 'tab1', name: 'L.O Red Unified Parser', func: 'flow.set("lo_red_health", true);', wires: [[], []] },
  ];
}

test('the plan inserts one demux node between the tuya node and both parsers, on the data output only', () => {
  const before = liveFlow();
  const plan = planChannelDemux(before, { site: SITE, registry: BUILT_IN_DEVICES });
  assert.equal(plan.unchanged, false);
  assert.equal(plan.flows.length, before.length + 1);
  const demux = plan.flows.find((n) => n.id === `${DEMUX_NODE_ID_PREFIX}co_yel`);
  assert.ok(demux, 'deterministic id');
  assert.equal(demux.type, 'function');
  assert.equal(demux.z, 'tab1');
  assert.deepEqual(demux.wires, [['pCO', 'pLO']]);
  assert.equal(demux.func, SRC);
  const tuya = plan.flows.find((n) => n.id === 'tuya1');
  assert.deepEqual(tuya.wires, [[demux.id], ['pCO', 'pLO']], 'status output still reaches the parsers directly');
  assert.deepEqual(before, liveFlow(), 'the input array is not mutated');
});

test('re-running on a patched flow is a no-op', () => {
  const first = planChannelDemux(liveFlow(), { site: SITE, registry: BUILT_IN_DEVICES });
  const second = planChannelDemux(first.flows, { site: SITE, registry: BUILT_IN_DEVICES });
  assert.equal(second.unchanged, true);
});

test('a patched flow whose demux code is stale gets only its code replaced', () => {
  const first = planChannelDemux(liveFlow(), { site: SITE, registry: BUILT_IN_DEVICES });
  const stale = first.flows.map((n) => (n.id.startsWith(DEMUX_NODE_ID_PREFIX) ? { ...n, func: '// old' } : n));
  const plan = planChannelDemux(stale, { site: SITE, registry: BUILT_IN_DEVICES });
  assert.equal(plan.unchanged, false);
  assert.deepEqual(plan.upgraded, [`${DEMUX_NODE_ID_PREFIX}co_yel`]);
  assert.equal(plan.flows.length, stale.length);
  assert.equal(validateChannelDemux(stale, plan.flows, plan).length, 0);
});

test('a flow where the pair is not fanned from one session is refused, not half-patched', () => {
  const twoSessions = liveFlow().map((n) => (n.id === 'tuya1' ? { ...n, wires: [['pCO'], ['pCO']] } : n));
  const plan = planChannelDemux(twoSessions, { site: SITE, registry: BUILT_IN_DEVICES });
  assert.equal(plan.unchanged, true);
  assert.match(plan.reason, /both parsers/);
});

test('the invariants: exactly one node added, only the tuya node rewired and only its data output', () => {
  const before = liveFlow();
  const plan = planChannelDemux(before, { site: SITE, registry: BUILT_IN_DEVICES });
  assert.deepEqual(validateChannelDemux(before, plan.flows, plan), []);

  const tampered = plan.flows.map((n) => (n.id === 'pRed' ? { ...n, func: 'changed' } : n));
  assert.ok(validateChannelDemux(before, tampered, plan).some((p) => /pRed|L\.O Red/.test(p)));

  const statusRewired = plan.flows.map((n) => (n.id === 'tuya1' ? { ...n, wires: [n.wires[0], [n.wires[0][0]]] } : n));
  assert.ok(validateChannelDemux(before, statusRewired, plan).some((p) => /status/.test(p)));

  const dangling = plan.flows.map((n) => (n.id.startsWith(DEMUX_NODE_ID_PREFIX) ? { ...n, wires: [['nowhere']] } : n));
  assert.ok(validateChannelDemux(before, dangling, plan).some((p) => /non-existent/.test(p)));
});
