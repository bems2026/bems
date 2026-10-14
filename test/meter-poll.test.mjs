/**
 * The patch that gives the CT meters the periodic GET every other tuya node already has (RM-134).
 *
 * Why it exists, measured 2026-09-22: every outlet, every light switch and the IR hub is fed a
 * `{ operation: 'GET' }` poll; the three meter sessions were fed none. The tuya node never reads a
 * device's state on connect (`issueGetOnConnect: false` is hard-coded in the node), so a meter was
 * push-only: a change it pushed while the bridge was down was never seen, and a channel then
 * sitting at 0 W had nothing new to push. L.O Yellow held 39.8 W from 07:43 while its own register
 * stood still — read as a frozen clamp, and it was a value nobody re-read.
 *
 * The fixture mirrors the live Energy tab: the dual meter's session feeds its two parsers through
 * the channel demux; the two single meters feed their parsers directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planMeterPoll,
  validateMeterPoll,
  meterSessions,
  POLL_FN_ID,
  POLL_INJECT_ID,
  POLL_INTERVAL_S,
} from '../node-red-bridge/meterPollPlan.mjs';

const parser = (id, ctx, z = 'tabEnergy') => ({ id, type: 'function', z, name: `${ctx} parser`, func: `flow.set("${ctx}_health", isOnline);`, wires: [[], []] });
const tuya = (id, name, data, status, z = 'tabEnergy') => ({ id, type: 'tuya-smart-device', z, deviceName: name, deviceId: 'd' + id, x: 100, y: 200, wires: [data, status] });

const flow = () => [
  { id: 'tabEnergy', type: 'tab', label: 'Energy Monitoring' },
  { id: 'tabOutlet', type: 'tab', label: 'Outlet' },
  tuya('tYel', 'C.O yellow', ['bems_chan_demux_co_yel'], ['pCo', 'pLo']),
  { id: 'bems_chan_demux_co_yel', type: 'function', z: 'tabEnergy', name: 'Channel demux', func: '// demux', outputs: 1, y: 280, wires: [['pCo', 'pLo']] },
  parser('pCo', 'co_yel'),
  parser('pLo', 'lo_yel2'),
  tuya('tRed', 'L.O red', ['pRed'], ['pRed']),
  parser('pRed', 'lo_red'),
  tuya('tAcu', 'AREC ACU', ['pAcu'], ['pAcu']),
  parser('pAcu', 'arec'),
  tuya('tCo1', 'CO1', ['pCo1'], ['pCo1'], 'tabOutlet'),
  parser('pCo1', 'co1', 'tabOutlet'),
];

const registry = () => [
  { id: 'co1', class: 'outlet_dual', ctx: 'co1' },
  { id: 'mtr_co_yellow', class: 'meter', ctx: 'co_yel', channel: 1, capability_profile: 'cz_ct_double' },
  { id: 'mtr_lo_red', class: 'meter', ctx: 'lo_red', capability_profile: 'cz_ct_single' },
  { id: 'mtr_arec_acu', class: 'meter', ctx: 'arec', capability_profile: 'cz_ct_single' },
  { id: 'mtr_lo_yellow', class: 'meter', ctx: 'lo_yel2', channel: 2, capability_profile: 'cz_ct_double' },
  { id: 'l1', class: 'switch' },
];

const plan = (f = flow(), r = registry()) => planMeterPoll(f, { registry: r });
const fnOf = (flows) => flows.find((n) => n.id === POLL_FN_ID);
const run = (fn, health) => new Function('flow', fn.func)({ get: (k) => health[k] });

test('targets every meter session and nothing else — the dual meter is ONE session', () => {
  const sessions = meterSessions(flow(), registry());
  assert.deepEqual(sessions.map((s) => s.node.deviceName), ['C.O yellow', 'L.O red', 'AREC ACU']);
  assert.deepEqual(sessions[0].devices, ['mtr_co_yellow', 'mtr_lo_yellow'], 'both logical meters ride one session');
});

test('a session is found through the channel demux as well as directly', () => {
  const [yel] = meterSessions(flow(), registry());
  assert.equal(yel.node.id, 'tYel');
});

test('adds exactly two nodes, one output per session, on the meters\' own tab', () => {
  const { flows, added, targets } = plan();
  assert.equal(added.length, 2);
  assert.deepEqual(targets, ['C.O yellow', 'L.O red', 'AREC ACU']);
  const fn = fnOf(flows);
  assert.equal(fn.outputs, 3);
  assert.deepEqual(fn.wires, [['tYel'], ['tRed'], ['tAcu']], 'one GET per session, never two to the dual meter');
  assert.equal(fn.z, 'tabEnergy', 'flow.get reads the tab the parsers write');
  assert.equal(flows.find((n) => n.id === POLL_INJECT_ID).z, 'tabEnergy');
});

test('sends the operation the tuya node accepts, at the ingestion cadence, soon after a deploy', () => {
  const { flows } = plan();
  assert.match(fnOf(flows).func, /operation:\s*'GET'/);
  assert.match(fnOf(flows).func, /operation:\s*'REFRESH'/, 'preflight\'s flow_polls reads these literals');
  const inject = flows.find((n) => n.id === POLL_INJECT_ID);
  assert.equal(POLL_INTERVAL_S, 60);
  assert.equal(inject.repeat, '60');
  assert.equal(inject.once, true, 'the first read must not wait a full minute');
  assert.deepEqual(inject.wires, [[POLL_FN_ID]]);
});

const SINGLE = [105, 106, 107, 108, 109];
const DOUBLE = [105, 106, 107, 108, 109, 115, 116, 117, 118, 119, 123];
const refreshThenGet = (dps) => [{ payload: { operation: 'REFRESH', requestedDPS: dps } }, { payload: { operation: 'GET' } }];

test('a disconnected session is skipped, and an unknown one is still polled', () => {
  const fn = fnOf(plan().flows);
  const out = run(fn, { co_yel_health: false, lo_red_health: true });
  assert.equal(out[0], null, 'a session the parser has flagged down must not be polled');
  assert.deepEqual(out[1], refreshThenGet(SINGLE));
  assert.deepEqual(out[2], refreshThenGet(SINGLE), 'no health key yet must still poll — refusing would keep it silent');
});

/* 2026-10-14, RM-163. With the site offline for a week the meters kept answering GET with the same cached
 * figures (CO Yellow at 261.3 W, one voltage, for 130 hours) while the outlets stayed live. These meters
 * re-read their measurements only on a DP_REFRESH (tuyapi refresh, command 18), which the vendor cloud had
 * been sending. Each session is now asked to refresh exactly its profile's measured dps, then read. */
test('each session is asked to REFRESH its measured dps, then to GET — the dual meter both channels at once', () => {
  const out = run(fnOf(plan().flows), {});
  assert.deepEqual(out[0], refreshThenGet(DOUBLE), 'the dual meter: both channels and the combined register');
  assert.deepEqual(out[1], refreshThenGet(SINGLE));
  assert.deepEqual(out[2], refreshThenGet(SINGLE));
});

test('every message is a fresh object — the tuya node deletes `operation` from the payload it is handed', () => {
  const out = run(fnOf(plan().flows), {});
  delete out[0][0].payload.operation;
  delete out[0][1].payload.operation;
  assert.equal(out[1][0].payload.operation, 'REFRESH', 'one session consuming its message must not empty another\'s');
  assert.equal(out[1][1].payload.operation, 'GET');
  const again = run(fnOf(plan().flows), {});
  assert.notEqual(again[0][0].payload.requestedDPS, out[0][0].payload.requestedDPS, 'nor a later tick\'s');
});

test('a meter with no capability profile is still read, with GET alone', () => {
  const bare = registry().map((d) => (d.id === 'mtr_arec_acu' ? { ...d, capability_profile: undefined } : d));
  const res = plan(flow(), bare);
  const out = run(fnOf(res.flows), {});
  assert.deepEqual(out[2], { payload: { operation: 'GET' } });
  assert.deepEqual(res.refreshing, ['C.O yellow', 'L.O red'], 'the plan says which sessions are refreshed');
});

test('is idempotent — an already-current poller is left completely alone', () => {
  const once = plan();
  const twice = planMeterPoll(once.flows, { registry: registry() });
  assert.equal(twice.unchanged, true);
  assert.match(twice.reason, /already present and current/);
  assert.equal(JSON.stringify(twice.flows), JSON.stringify(once.flows));
});

test('an outdated poller is upgraded in place — a meter was enrolled since', () => {
  const { flows: installed } = plan(flow(), registry().filter((d) => d.id !== 'mtr_arec_acu'));
  assert.equal(fnOf(installed).outputs, 2);
  const { flows: after, added, upgraded, unchanged } = planMeterPoll(installed, { registry: registry() });
  assert.equal(unchanged, false);
  assert.equal(added.length, 0);
  assert.deepEqual(upgraded, [POLL_FN_ID]);
  assert.deepEqual(fnOf(after).wires, [['tYel'], ['tRed'], ['tAcu']]);
  assert.deepEqual(validateMeterPoll(installed, after, { registry: registry() }), []);
});

test('refuses, writing nothing, when an active meter cannot be located', () => {
  // A meter the poller silently leaves out is exactly the failure this exists to end.
  const noParser = flow().filter((n) => n.id !== 'pAcu');
  const res = plan(noParser);
  assert.equal(res.unchanged, true);
  assert.match(res.reason, /mtr_arec_acu/);
  assert.equal(res.flows.length, noParser.length);
});

test('a second writer of the health key that no session feeds is not a parser — the live AREC ACU shape', () => {
  // Measured on the live flow 2026-09-22: the Aircon tab's legacy "AREC ACU Daily Parser" also writes
  // `arec_health`, fed by a 2 s inject, in its own tab's context. It is not a device parser and must
  // neither be polled nor make the meter unlocatable.
  const legacy = { id: 'pAcuDaily', type: 'function', z: 'tabAircon', name: 'AREC ACU Daily Parser', func: 'flow.set("arec_health", x);', wires: [[], []] };
  const tick = { id: 'tick', type: 'inject', z: 'tabAircon', repeat: '2', wires: [['pAcuDaily']] };
  const res = plan([...flow(), legacy, tick]);
  assert.equal(res.unchanged, false, res.reason);
  assert.deepEqual(res.targets, ['C.O yellow', 'L.O red', 'AREC ACU']);
});

test('two parsers that sessions DO feed for one meter is ambiguous, and refused', () => {
  const twin = [...flow(), tuya('tAcu2', 'AREC ACU copy', ['pAcu2'], []), parser('pAcu2', 'arec')];
  const res = plan(twin);
  assert.equal(res.unchanged, true);
  assert.match(res.reason, /mtr_arec_acu/);
});

test('refuses when the meter sessions are on different tabs — one function reads one tab\'s context', () => {
  const split = flow().map((n) => (n.id === 'tAcu' || n.id === 'pAcu' ? { ...n, z: 'tabOther' } : n));
  const res = plan(split);
  assert.equal(res.unchanged, true);
  assert.match(res.reason, /more than one tab/);
});

test('modifies no existing node — the install only adds', () => {
  const before = flow();
  const { flows } = plan(before);
  assert.deepEqual(validateMeterPoll(before, flows, { registry: registry() }), []);
  for (const original of before) assert.deepEqual(flows.find((n) => n.id === original.id), original);
});

test('validation catches a session the poller would miss', () => {
  const before = flow();
  const missing = plan(before).flows.map((n) => (n.id === POLL_FN_ID ? { ...n, outputs: 2, wires: [['tYel'], ['tRed']] } : n));
  assert.ok(validateMeterPoll(before, missing, { registry: registry() }).some((p) => p.includes('AREC ACU')));
});

test('validation rejects a fanned-out output, which cannot skip one session', () => {
  const before = flow();
  const fanned = plan(before).flows.map((n) => (n.id === POLL_FN_ID ? { ...n, outputs: 1, wires: [['tYel', 'tRed', 'tAcu']] } : n));
  const problems = validateMeterPoll(before, fanned, { registry: registry() });
  assert.ok(problems.some((p) => /1 output\(s\) for 3 meter session/.test(p)), problems.join(' | '));
});

test('validation rejects a poll function that consults no health key', () => {
  const before = flow();
  const inert = plan(before).flows.map((n) => (n.id === POLL_FN_ID ? { ...n, func: "return [{payload:{operation:'GET'}},{payload:{operation:'GET'}},{payload:{operation:'GET'}}];" } : n));
  assert.ok(validateMeterPoll(before, inert, { registry: registry() }).some((p) => /cannot be skipped/.test(p)));
});

test('validation catches a modified, a removed, and a dangling node', () => {
  const before = flow();
  const { flows } = plan(before);
  const reg = { registry: registry() };
  assert.ok(validateMeterPoll(before, flows.map((n) => (n.id === 'tRed' ? { ...n, wires: [[], []] } : n)), reg).some((p) => p.includes('modified')));
  assert.ok(validateMeterPoll(before, flows.filter((n) => n.id !== 'pRed'), reg).some((p) => p.includes('pRed')));
  assert.ok(validateMeterPoll(before, flows.map((n) => (n.id === POLL_FN_ID ? { ...n, wires: [['nope'], ['tRed'], ['tAcu']] } : n)), reg).some((p) => p.includes('nope')));
});
