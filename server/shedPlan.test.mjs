import test from 'node:test';
import assert from 'node:assert/strict';
import { planShed, shedTargets } from './shedPlan.mjs';

const USER = '22222222-2222-2222-2222-222222222222';
const totals = (over = {}) => ({ total_power_w: 9000, phase_current: { red: 10, yellow: 12, blue: null }, ...over });
const on = (ids) => Object.fromEntries(ids.map((id) => [id, { state: 'on' }]));

/**
 * `devices` became a required input in RM-067: shed targets are enumerated per SOCKET now, and
 * only the registry knows how many an outlet has. The five switches below keep every test
 * written before that change meaning exactly what it meant.
 */
const SWITCHES = ['l1', 'l2', 'l3', 'l4', 'l5'].map((id) => ({ id, class: 'switch', state_key: id.toUpperCase() }));
const OUTLETS = [
  { id: 'co1', class: 'outlet_dual', sockets: ['CO1_1', 'CO1_2'] },
  { id: 'co2', class: 'outlet_dual', sockets: ['CO2_1', 'CO2_2'] },
];

const base = {
  thresholds: { maxPhaseA: 20, maxTotalKw: 5, autoShed: true },
  totals: totals(),
  devices: SWITCHES,
  configs: { l1: 'group_1', l2: 'group_1', l3: 'group_2', l4: 'never', l5: null },
  socketConfigs: {},
  readings: on(['l1', 'l2', 'l3', 'l4', 'l5']),
  dispatchableDeviceIds: ['l1', 'l2', 'l3', 'l4', 'l5'],
  actorUserId: USER,
};
const plan = (over = {}) => planShed({ ...base, ...over });
const ids = (p) => p.shed.map((c) => c.device_id).sort();
/** `device:socket` pairs — the whole observable result once sockets became the unit. */
const targets = (p) => p.shed.map((c) => `${c.device_id}:${c.socket ?? '-'}`).sort();

test('sheds nothing when nothing is over the limit', () => {
  const p = plan({ totals: totals({ total_power_w: 1000, phase_current: { red: 1, yellow: 1, blue: null } }) });
  assert.equal(p.breached, false);
  assert.equal(p.shed.length, 0);
});

test('sheds the first tier when the total-draw limit is breached', () => {
  const p = plan();
  assert.equal(p.breached, true);
  assert.equal(p.tier, 'group_1');
  assert.deepEqual(ids(p), ['l1', 'l2']);
  assert.ok(p.shed.every((c) => c.action === 'off'));
});

test('escalates one tier at a time — group_2 only once group_1 has nothing left to shed', () => {
  const p = plan({ readings: { ...on(['l3', 'l4', 'l5']), l1: { state: 'off' }, l2: { state: 'off' } } });
  assert.equal(p.tier, 'group_2');
  assert.deepEqual(ids(p), ['l3']);
});

test('never sheds a Protected device, even when every tier is exhausted', () => {
  const p = plan({ configs: { l4: 'never' }, devices: SWITCHES.filter((d) => d.id === 'l4'), readings: on(['l4']) });
  assert.equal(p.breached, true, 'still over the limit');
  assert.equal(p.shed.length, 0, 'but nothing may be shed');
});

test('never sheds a device with no shed group assigned — an unconfigured device is not a volunteer', () => {
  const p = plan({ configs: { l5: null }, devices: SWITCHES.filter((d) => d.id === 'l5'), readings: on(['l5']) });
  assert.equal(p.shed.length, 0);
});

test('does not shed a device that is already off — no pointless command, no misleading audit row', () => {
  const p = plan({ readings: { ...on(['l2']), l1: { state: 'off' } } });
  assert.deepEqual(ids(p), ['l2']);
});

test('does not shed a device the command path cannot actually dispatch', () => {
  const p = plan({ configs: { co1: 'group_1' }, readings: on(['co1']), dispatchableDeviceIds: [] });
  assert.equal(p.shed.length, 0);
});

test('sheds nothing when auto-shed is switched off, though the breach is still reported', () => {
  const p = plan({ thresholds: { ...base.thresholds, autoShed: false } });
  assert.equal(p.breached, true);
  assert.equal(p.reason !== null, true);
  assert.equal(p.shed.length, 0);
});

test('an unconfigured threshold never sheds — no limit set is not a limit of zero', () => {
  const p = plan({ thresholds: { maxPhaseA: null, maxTotalKw: null, autoShed: true } });
  assert.equal(p.breached, false);
  assert.equal(p.shed.length, 0);
});

test('sheds on a phase-current breach as well as a total-draw one', () => {
  const p = plan({ thresholds: { maxPhaseA: 5, maxTotalKw: null, autoShed: true } });
  assert.equal(p.breached, true);
  assert.match(p.reason, /phase current/i);
  assert.deepEqual(ids(p), ['l1', 'l2']);
});

test('sheds nothing with no reading at all, rather than treating missing data as an overload', () => {
  const p = plan({ totals: null });
  assert.equal(p.breached, false);
  assert.equal(p.shed.length, 0);
});

test('skips shedding when nobody is on record as having enabled it', () => {
  const p = plan({ actorUserId: null });
  assert.equal(p.breached, true);
  assert.equal(p.shed.length, 0);
});

test('attributes each shed command to whoever configured the thresholds, and marks its source', () => {
  const p = plan();
  assert.ok(p.shed.every((c) => c.requested_by === USER));
  assert.ok(p.shed.every((c) => c.source === 'dsm_autoshed'));
});


/* ===========================================================================
 * RM-067 — the shed unit is a SOCKET, not a device.
 * ======================================================================== */

const outletBase = {
  ...base,
  devices: OUTLETS,
  configs: {},
  socketConfigs: {},
  readings: { co1: { socket_states: { 1: 'on', 2: 'on' } }, co2: { socket_states: { 1: 'on', 2: 'on' } } },
  dispatchableDeviceIds: ['co1', 'co2'],
};
const outletPlan = (over = {}) => planShed({ ...outletBase, ...over });

test('shedTargets enumerates one entry per socket for an outlet and one for everything else', () => {
  const out = shedTargets({ devices: [...OUTLETS, ...SWITCHES.slice(0, 1)], configs: {}, socketConfigs: {} });
  assert.deepEqual(
    out.map((t) => `${t.device_id}:${t.socket ?? '-'}`),
    ['co1:1', 'co1:2', 'co2:1', 'co2:2', 'l1:-'],
  );
});

test('shedTargets takes the socket count from the registry, never a hard-coded 2', () => {
  const single = [{ id: 'co9', class: 'outlet_dual', sockets: ['CO9_1'] }];
  assert.equal(shedTargets({ devices: single, configs: {}, socketConfigs: {} }).length, 1);
});

test('a device-level tier with no socket rows still sheds BOTH sockets — the backfill guarantee', () => {
  const p = outletPlan({ configs: { co1: 'group_1' } });
  assert.deepEqual(targets(p), ['co1:1', 'co1:2']);
});

test('a socket tier overrides the device tier for THAT SOCKET ONLY', () => {
  const p = outletPlan({ configs: { co1: 'group_2' }, socketConfigs: { co1: { 1: 'group_1' } } });
  assert.equal(p.tier, 'group_1', 'socket 1 was promoted to the first tier');
  assert.deepEqual(targets(p), ['co1:1'], 'socket 2 keeps group_2 and is not touched yet');
});

test('socket 1 sheddable and socket 2 Protected sheds exactly one relay', () => {
  const p = outletPlan({ socketConfigs: { co1: { 1: 'group_1', 2: 'never' } } });
  assert.deepEqual(targets(p), ['co1:1']);
});

test('an outlet with socket 1 on and socket 2 off sheds ONE command, not two', () => {
  // The derived device-level `state` is `s1 || s2`, so shedding on it would send a pointless
  // off to a relay that is already off and write a misleading audit row for it.
  const p = outletPlan({
    socketConfigs: { co1: { 1: 'group_1', 2: 'group_1' } },
    readings: { co1: { socket_states: { 1: 'on', 2: 'off' } } },
  });
  assert.deepEqual(targets(p), ['co1:1']);
});

test('an outlet with both sockets off sheds nothing, and does not block escalation', () => {
  const p = outletPlan({
    socketConfigs: { co1: { 1: 'group_1', 2: 'group_1' }, co2: { 1: 'group_2', 2: 'group_2' } },
    readings: { co1: { socket_states: { 1: 'off', 2: 'off' } }, co2: { socket_states: { 1: 'on', 2: 'on' } } },
  });
  assert.equal(p.tier, 'group_2', 'group_1 had nothing left, so it escalated');
  assert.deepEqual(targets(p), ['co2:1', 'co2:2']);
});

test('a reading with NO socket_states is not sheddable — never assumed on', () => {
  // An older bridge that does not emit socket_states must not have an "on" invented for it.
  const p = outletPlan({ socketConfigs: { co1: { 1: 'group_1' } }, readings: { co1: { state: 'on' } } });
  assert.equal(p.shed.length, 0);
});

test('every shed command for an outlet names a socket — none carries socket: null', () => {
  // The regression that would silently re-open `socket_required` at dispatch.
  const p = outletPlan({ configs: { co1: 'group_1', co2: 'group_1' } });
  assert.ok(p.shed.length > 0);
  assert.ok(p.shed.every((c) => c.socket === 1 || c.socket === 2), JSON.stringify(p.shed));
});

test('output is sorted by (device_id, socket) and stable', () => {
  const p = outletPlan({ configs: { co1: 'group_1', co2: 'group_1' } });
  assert.deepEqual(targets(p), ['co1:1', 'co1:2', 'co2:1', 'co2:2']);
  assert.deepEqual(p.shed.map((c) => `${c.device_id}:${c.socket}`), ['co1:1', 'co1:2', 'co2:1', 'co2:2']);
});

test('a non-dispatchable outlet is skipped even with a tier and a live socket', () => {
  const p = outletPlan({ configs: { co1: 'group_1' }, dispatchableDeviceIds: [] });
  assert.equal(p.shed.length, 0);
});

test('a switch still sheds with socket null, unchanged by any of this', () => {
  const p = plan();
  assert.deepEqual(targets(p), ['l1:-', 'l2:-']);
});
