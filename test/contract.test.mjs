/**
 * Contract tests for the bridge layer.
 *
 *     npm run test:bridge
 *
 * These guard the failure modes that would be most expensive to find later:
 *   1. the mock and the Node-RED bridge drifting apart, so the frontend works locally
 *      and breaks on the Pi;
 *   2. the Node-RED (Pi) flow gaining a write path it hasn't been verified for — Stage 2
 *      (Phase L) added device control, but ONLY to mock-bridge/server.mjs. The Pi
 *      deployment stays parked and read-only until it's built and verified on site; see
 *      docs/bridge-contract.md's Deployment section before changing that.
 *   3. the mock-only command contract itself regressing — the validation matrix and the
 *      "never reported as confirmed" test below.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { DEVICE_REGISTRY, PHASE_MAP, publicDevices } from '../shared/registry.mjs';
import { buildLatest } from '../shared/buildLatest.mjs';
import { COMMAND_ROUTE, ACCEPTED_STATUS, validateCommand, buildAck } from '../shared/commands.mjs';
import { CONTEXT_ROUTE, CONTEXT_ACCEPTED_STATUS, validateContextWrite, buildContextAck } from '../shared/context.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const flow = JSON.parse(readFileSync(join(ROOT, 'node-red-bridge', 'bridge-flow.json'), 'utf8'));
const BRIDGE_TAB = 'b41d9e0000000001';

/** A snapshot in exactly the shape the Node-RED collectors emit. */
const snapshot = () => ({
  energy: {
    meters: {
      co_yel: { v: '221.4', c: '1.820', p: '402.1', e: '3.1100', h: true },
      lo_red: { v: '220.0', c: '2.000', p: '440.0', e: '5.0000', h: true },
      arec: { v: '219.5', c: '4.100', p: '900.0', e: '9.0000', h: true },
      lo_yel2: {}, // offline: reports nothing at all
    },
    totals: { today: '12.41', week: '61.88', month: '204.3' },
  },
  outlet: {
    meters: { co1: { v: '220.1', c: '0.500', p: '110.0', e: '1.2000', h: true, t: 1786000000000 } },
    state: { status: { CO1_1: true, CO1_2: false, CO2_1: false, CO2_2: false } },
  },
  switch: { state: { L1: true, L2: false }, health: { 1: { conn: 'CONNECTED' }, 2: { conn: 'CONNECTED' } } },
  aircon: { state: { power: true, setTemp: 24, roomTemp: '25.4', humidity: '62.0', outTemp: '31.8' } },
});

const rows = () => buildLatest(snapshot(), DEVICE_REGISTRY, PHASE_MAP, 1786000000000);
const row = (id) => rows().find((r) => r.device_id === id);

// ---------------------------------------------------------------------------
// payload shape
// ---------------------------------------------------------------------------

test('emits one row per device plus a _totals row', () => {
  assert.equal(rows().length, DEVICE_REGISTRY.length + 1);
  assert.ok(row('_totals'));
});

test('absent readings are omitted, never coerced to zero', () => {
  // lo_yel2 reported nothing. "No data" and "zero watts" are different facts.
  const r = row('mtr_lo_yellow');
  assert.equal('voltage' in r, false);
  assert.equal('power_w' in r, false);
  assert.equal(r.online, false);
});

test('switch online reflects global.lightStatus.conn, not a hardcoded true', () => {
  const snap = snapshot();
  snap.switch.health = { 1: { conn: 'DISCONNECTED' }, 2: { conn: 'CONNECTED' } };
  const built = buildLatest(snap, DEVICE_REGISTRY, PHASE_MAP, 1786000000000);
  const l1 = built.find((r) => r.device_id === 'l1');
  const l2 = built.find((r) => r.device_id === 'l2');
  assert.equal(l1.online, false);
  assert.equal(l2.online, true);
});

test('switch online falls back to true when no health entry exists (older flow, or a mock that omits it) — never a false negative from an absent signal', () => {
  const snap = snapshot();
  snap.switch.health = {}; // no entries at all for l1/l2
  const built = buildLatest(snap, DEVICE_REGISTRY, PHASE_MAP, 1786000000000);
  assert.equal(built.find((r) => r.device_id === 'l1').online, true);
});

test('switch online falls back to true when the whole snapshot.switch.health key is absent — pre-fix collector shape, no regression', () => {
  const snap = snapshot();
  delete snap.switch.health;
  const built = buildLatest(snap, DEVICE_REGISTRY, PHASE_MAP, 1786000000000);
  assert.equal(built.find((r) => r.device_id === 'l1').online, true);
});

test('string readings from Tuya parsers are coerced to numbers', () => {
  const r = row('mtr_co_yellow');
  assert.equal(typeof r.voltage, 'number');
  assert.equal(r.voltage, 221.4);
  assert.equal(r.power_w, 402.1);
});

test('blue phase is null, not zero — no Blue-phase meter is installed', () => {
  const p = row('_totals').phase_current;
  assert.equal(p.blue, null);
  assert.notEqual(p.blue, 0);
  assert.equal(typeof p.red, 'number');
});

test('phase totals follow Calculate 3-Phase Totals: red = lo_red + arec', () => {
  assert.equal(row('_totals').phase_current.red, 6.1); // 2.000 + 4.100
});

test('an offline meter is excluded from total_power_w/avg_voltage/phase_current, even while it still reports a stale v/c/p', () => {
  // Caught live: a meter's context keeps its last-known v/c/p after a real disconnect —
  // that's the whole point of "last known reading" — but a building-wide total is a claim
  // about right now, not a museum of frozen values. Health going false must zero out this
  // meter's contribution to every aggregate, not just its own row's online flag.
  const snap = snapshot();
  snap.energy.meters.lo_red.h = false; // still reports v/c/p, just no longer connected
  const built = buildLatest(snap, DEVICE_REGISTRY, PHASE_MAP, 1786000000000);
  const totals = built.find((r) => r.device_id === '_totals');

  // Without lo_red (v220.0 c2.000 p440.0): total_power_w = 402.1(co_yel) + 900.0(arec) = 1302.1
  assert.equal(totals.total_power_w, 1302.1);
  // avg_voltage over co_yel(221.4) + arec(219.5) only, not lo_red's 220.0
  assert.equal(totals.avg_voltage, 220.5);
  // phase red = lo_red.current + arec.current normally (6.1); with lo_red offline, only arec's 4.100 counts
  assert.equal(totals.phase_current.red, 4.1);
});

test('every meter offline leaves total_power_w/avg_voltage/phase_current null, never a fabricated 0', () => {
  const snap = snapshot();
  for (const m of Object.values(snap.energy.meters)) m.h = false;
  const built = buildLatest(snap, DEVICE_REGISTRY, PHASE_MAP, 1786000000000);
  const totals = built.find((r) => r.device_id === '_totals');
  assert.equal(totals.total_power_w, null);
  assert.equal(totals.avg_voltage, null);
  assert.equal(totals.phase_current.red, null);
  assert.equal(totals.phase_current.yellow, null);
});

test('a dual outlet is on when either socket is on', () => {
  const r = row('co1');
  assert.deepEqual(r.socket_states, { 1: 'on', 2: 'off' });
  assert.equal(r.state, 'on');
});

test('switch state comes from bems_lights_state', () => {
  assert.equal(row('l1').state, 'on');
  assert.equal(row('l2').state, 'off');
});

test('meters and sensors have null state — they are not switchable', () => {
  assert.equal(row('mtr_lo_red').state, null);
  assert.equal(row('sens_outside_temp').state, null);
});

test('timestamps are ISO 8601 at +08:00 regardless of host timezone', () => {
  for (const r of rows()) assert.match(r.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);
});

test('/api/devices exposes no internal wiring fields', () => {
  for (const d of publicDevices()) {
    for (const leaked of ['ctx', 'state_key', 'state_ctx', 'state_field']) {
      assert.equal(leaked in d, false, `${d.id} leaked ${leaked}`);
    }
  }
});

// ---------------------------------------------------------------------------
// mock <-> Node-RED parity
// ---------------------------------------------------------------------------

test('the Node-RED flow inlines shared/buildLatest.mjs verbatim (no drift)', () => {
  // \r\n -> \n first: on a Windows checkout with core.autocrlf=true this file is CRLF on
  // disk, but build-flow.mjs normalizes to LF before embedding (see its own header comment)
  // — comparing raw CRLF against that would report every generation as "stale" for a reason
  // that has nothing to do with an actual content drift.
  const shared = readFileSync(join(ROOT, 'shared', 'buildLatest.mjs'), 'utf8').replace(/\r\n/g, '\n').replace(/^export /gm, '');
  const fn = flow.find((n) => n.name === 'Build latest readings');
  assert.ok(fn, 'Build latest readings node missing');
  assert.ok(
    fn.func.includes(shared.trim()),
    'bridge-flow.json is stale — run `npm run build:flow` after editing shared/buildLatest.mjs'
  );
});

test('the flow registry matches shared/registry.mjs (no drift)', () => {
  const fn = flow.find((n) => n.name === 'Serve devices');
  const served = JSON.parse(fn.func.match(/msg\.payload = (\[[\s\S]*?\]);/)[1]);
  assert.deepEqual(served, publicDevices());
});

// ---------------------------------------------------------------------------
// Pi read-only guarantee — the Node-RED flow, specifically. Stage 2 (Phase L) added
// device control to mock-bridge/server.mjs only; the assertions below are UNCHANGED from
// Stage 1 and still pass on their own, because the Pi flow itself never grew a write path.
// Re-titled so a green run says what's actually still true, not what used to be true
// system-wide.
// ---------------------------------------------------------------------------

test('the Node-RED (Pi) flow is still read-only — the Stage 2 write path is mock-only', () => {
  // If you're here because you added an `http in` node to make this fail: you are
  // deploying device control to real hardware. That's a real, separate decision — read
  // docs/bridge-contract.md's Deployment section first, and know that shared/commands.mjs
  // is currently imported by the mock and the tests only, never by build-flow.mjs.
  const ins = flow.filter((n) => n.type === 'http in');
  assert.deepEqual(ins.map((n) => n.url).sort(), ['/api/devices', '/api/readings/history', '/api/readings/latest']);
  for (const n of ins) assert.equal(n.method, 'get', `${n.url} is not GET`);
});

test('the command route is defined once, in shared/, so the mock and any future bridge cannot silently diverge', () => {
  assert.equal(COMMAND_ROUTE, '/api/command');
  assert.equal(ACCEPTED_STATUS, 202); // accepted, NOT completed — see the honesty test below
});

test('the context route is defined once too, and shares the command route\'s 202-not-200 posture', () => {
  assert.equal(CONTEXT_ROUTE, '/api/context');
  assert.equal(CONTEXT_ACCEPTED_STATUS, 202);
});

test('build-flow.mjs imports neither write-path module — the Pi flow stays generated from read-only sources', () => {
  const src = readFileSync(join(ROOT, 'node-red-bridge', 'build-flow.mjs'), 'utf8');
  assert.equal(/from ['"].*shared\/commands\.mjs['"]/.test(src), false, 'build-flow.mjs imports shared/commands.mjs');
  assert.equal(/from ['"].*shared\/context\.mjs['"]/.test(src), false, 'build-flow.mjs imports shared/context.mjs');
});

test('the Node-RED (Pi) flow still contains no device-command or outbound-request nodes', () => {
  // Unchanged from Stage 1, deliberately. A `tuya-smart-device` node appearing here means
  // someone wired the dashboard to real relays without the on-site verification that
  // requires — this stays a hard stop, not a warning.
  for (const forbidden of ['http request', 'tuya-smart-device', 'mqtt out', 'websocket in']) {
    assert.equal(flow.some((n) => n.type === forbidden), false, `found a ${forbidden} node`);
  }
});

test('the mock bridge cannot reach real hardware either — its command path is a pure in-process simulation', () => {
  // "Mock-only write path" is only a safe claim while the mock stays a genuine
  // simulation. It must mutate its own in-memory override map and nothing external.
  const src = readFileSync(join(ROOT, 'mock-bridge', 'server.mjs'), 'utf8');
  for (const forbidden of ['tuya', 'mqtt', "'node:dgram'", "'node:net'", 'fetch(']) {
    assert.equal(src.includes(forbidden), false, `mock-bridge references ${forbidden}`);
  }
});

test('collectors on existing tabs never write flow context', () => {
  // Still true in Stage 2 — the mock's command path mutates its own override map; nothing
  // in the Node-RED flow writes to a source tab's context.
  //
  // This is the test that would have to change if a real Pi write path is ever built, and
  // that change must be argued for explicitly: `flow.set('bems_outlets_state', …)` on the
  // Outlet tab is precisely the write that makes commanded state indistinguishable from
  // measured state downstream. The legacy flow does exactly that, which is why
  // socket_states has never been hardware-confirmed — see §5.1 of the Phase L plan and
  // this file's "an accepted command is never reported as confirmed" test.
  const collectors = flow.filter((n) => /^Bridge collect/.test(n.name || ''));
  assert.equal(collectors.length, 4, 'expected one collector per source tab');
  for (const c of collectors) {
    assert.equal(/flow\.set/.test(c.func), false, `${c.name} writes context`);
    assert.notEqual(c.z, BRIDGE_TAB, `${c.name} must live on its source tab`);
  }
});

test('collectors are unwired from existing nodes — nothing rerouted', () => {
  // Every node the bridge adds to a source tab must only ever wire to another node
  // the bridge added. If it points at a pre-existing node, we have modified that flow.
  const added = new Set(flow.map((n) => n.id));
  for (const n of flow.filter((x) => x.z && x.z !== BRIDGE_TAB)) {
    for (const w of n.wires || []) {
      for (const t of w) assert.ok(added.has(t), `${n.name || n.type} wires into pre-existing node ${t}`);
    }
  }
});

test('every function body is syntactically valid JS', () => {
  for (const n of flow.filter((x) => x.type === 'function')) {
    assert.doesNotThrow(
      () => new Function('msg', 'flow', 'global', 'node', 'env', n.func),
      `syntax error in "${n.name}"`
    );
  }
});

test('flow has no dangling wires, links, or duplicate ids', () => {
  const ids = new Set(flow.map((n) => n.id));
  assert.equal(ids.size, flow.length, 'duplicate node id');
  for (const n of flow) {
    for (const w of n.wires || []) for (const t of w) assert.ok(ids.has(t), `dangling wire ${n.id} -> ${t}`);
    for (const l of n.links || []) assert.ok(ids.has(l), `dangling link ${n.id} -> ${l}`);
    if (n.type === 'websocket out') assert.ok(ids.has(n.server), 'dangling websocket-listener ref');
  }
});

// ---------------------------------------------------------------------------
// Command contract (Stage 2, mock-bridge only) — shared/commands.mjs
// ---------------------------------------------------------------------------

test('an accepted command is never reported as confirmed', () => {
  // Nothing in this system reads DPS 1 or 2 back from an outlet relay, so socket_states
  // is commanded state, not measured state. The ack says so in two independent ways: HTTP
  // 202 (accepted, not completed) and confirmed:false. Both are load-bearing — the UI's
  // "commanded, not measured" labelling keys off them. Changing either means the system
  // has gained real relay readback, which means shared/buildLatest.mjs changed too.
  const ack = buildAck({ device_id: 'co3', socket: 1, action: 'on', target: 'CO3_1', command_id: 'x' }, 1786000000000);
  assert.equal(ack.confirmed, false);
  assert.equal(ack.confirmation, 'none');
  assert.equal(ACCEPTED_STATUS, 202);
});

const V = (body) => validateCommand(body, DEVICE_REGISTRY);

test('a valid outlet socket command resolves to the legacy topic', () => {
  const r = V({ device_id: 'co3', socket: 1, action: 'on' });
  assert.equal(r.ok, true);
  assert.equal(r.cmd.target, 'CO3_1'); // matches the legacy Outlet Router's eq rules
});

test('socket 2 resolves to the second topic', () => {
  const r = V({ device_id: 'co5', socket: 2, action: 'off' });
  assert.equal(r.ok, true);
  assert.equal(r.cmd.target, 'CO5_2');
});

test('a switch command resolves to its bems_lights_state key', () => {
  const r = V({ device_id: 'l4', action: 'off' });
  assert.equal(r.ok, true);
  assert.equal(r.cmd.target, 'L4');
});

test('an acu_ir command resolves to the synthetic AC_POWER target', () => {
  const r = V({ device_id: 'acu_main', action: 'on' });
  assert.equal(r.ok, true);
  assert.equal(r.cmd.target, 'AC_POWER');
});

test('unknown device is 404, matching GET /api/readings/history\'s precedent', () => {
  const r = V({ device_id: 'co9', socket: 1, action: 'on' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  assert.equal(r.code, 'unknown_device');
});

test('meters and sensors are not commandable — they have no state at all', () => {
  for (const id of ['mtr_lo_red', 'mtr_co_yellow', 'mtr_arec_acu', 'mtr_lo_yellow', 'sens_outside_temp']) {
    const r = V({ device_id: id, action: 'on' });
    assert.equal(r.ok, false, `${id} should not be commandable`);
    assert.equal(r.code, 'not_commandable');
    assert.equal(r.status, 400);
  }
});

test('an outlet command must name a socket — there is no whole-outlet relay', () => {
  // state on an outlet_dual is derived (s1 || s2 in buildLatest.mjs), not a thing you
  // can command directly.
  const r = V({ device_id: 'co3', action: 'on' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'socket_required');
});

test('a socket index is rejected for devices that have no sockets', () => {
  for (const id of ['l1', 'acu_main']) {
    const r = V({ device_id: id, socket: 1, action: 'on' });
    assert.equal(r.ok, false, `${id} should reject a socket`);
    assert.equal(r.code, 'socket_not_applicable');
  }
});

test('socket must be the integer 1 or 2 — not "1", not 0, not 3, not 1.5', () => {
  for (const socket of [0, 3, '1', 1.5, true, null, -1]) {
    const r = V({ device_id: 'co1', socket, action: 'on' });
    assert.equal(r.ok, false, `accepted socket=${JSON.stringify(socket)}`);
    assert.equal(r.code, 'invalid_socket');
  }
});

test('action must be exactly "on" or "off" — never "toggle"', () => {
  // A toggle would be computed from state nothing can confirm, and a double-fire on a
  // retry would flip the relay back. Absolute set only — see shared/commands.mjs's header.
  for (const action of ['toggle', 'ON', 'On', true, 1, '', undefined, null]) {
    const r = V({ device_id: 'l1', action });
    assert.equal(r.ok, false, `accepted action=${JSON.stringify(action)}`);
    assert.equal(r.code, 'invalid_action');
  }
});

test('a non-object body is rejected before any field is read', () => {
  for (const body of [null, undefined, [], 'on', 42, true]) {
    const r = V(body);
    assert.equal(r.ok, false, `accepted body=${JSON.stringify(body)}`);
    assert.equal(r.code, 'invalid_body');
  }
});

test('every commandable target is distinct — 14 sockets, 7 lights, 1 aircon, no collisions', () => {
  const targets = new Set();
  for (const d of DEVICE_REGISTRY) {
    const sockets = d.class === 'outlet_dual' ? [1, 2] : [undefined];
    for (const socket of sockets) {
      const r = V({ device_id: d.id, socket, action: 'on' });
      if (!r.ok) continue;
      assert.equal(targets.has(r.cmd.target), false, `${d.id} collides on ${r.cmd.target}`);
      targets.add(r.cmd.target);
    }
  }
  assert.equal(targets.size, 22); // 14 outlet sockets + 7 lights + 1 aircon
});

test('commanded targets are exactly the keys buildLatest reads back — the round-trip that makes a toggle actually stick', () => {
  const co1 = DEVICE_REGISTRY.find((d) => d.id === 'co1');
  assert.deepEqual(co1.sockets, ['CO1_1', 'CO1_2']);
  assert.equal(V({ device_id: 'co1', socket: 1, action: 'on' }).cmd.target, co1.sockets[0]);
  assert.equal(V({ device_id: 'co1', socket: 2, action: 'on' }).cmd.target, co1.sockets[1]);
  const l1 = DEVICE_REGISTRY.find((d) => d.id === 'l1');
  assert.equal(V({ device_id: 'l1', action: 'on' }).cmd.target, l1.state_key);
});

// ---------------------------------------------------------------------------
// Context contract (Stage 2, mock-bridge only) — shared/context.mjs
// ---------------------------------------------------------------------------

test('a context write is never reported as confirmed, same honesty posture as a command', () => {
  const ack = buildContextAck({ 'global.trigger.care_acu_on': '28' }, 1786000000000);
  assert.equal(ack.confirmed, false);
  assert.deepEqual(ack.keys, ['global.trigger.care_acu_on']);
});

const VC = (body) => validateContextWrite(body, DEVICE_REGISTRY);

test('a schedule key for a real switchable device is accepted', () => {
  const r = VC({ writes: { 'global.schedule.l1.on': '07:30', 'global.schedule.co1.armed': 'true' } });
  assert.equal(r.ok, true);
});

test('a schedule key for a meter or sensor is rejected — neither has schedulable state', () => {
  for (const id of ['mtr_lo_red', 'sens_outside_temp']) {
    const r = VC({ writes: { [`global.schedule.${id}.armed`]: 'true' } });
    assert.equal(r.ok, false, `${id} should reject a schedule key`);
    assert.equal(r.code, 'invalid_key');
  }
});

test('a schedule key for an unknown device is rejected', () => {
  const r = VC({ writes: { 'global.schedule.co9.on': '07:00' } });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'invalid_key');
});

test('an unknown schedule field is rejected — only on/off/days/armed exist', () => {
  const r = VC({ writes: { 'global.schedule.l1.setpoint': '24' } });
  assert.equal(r.ok, false);
});

test('the one real trigger key is accepted; any other is rejected', () => {
  assert.equal(VC({ writes: { 'global.trigger.care_acu_on': '28' } }).ok, true);
  assert.equal(VC({ writes: { 'global.trigger.arec_acu_on': '28' } }).ok, false);
});

test('the three real DSM keys are accepted; anything else is rejected', () => {
  for (const key of ['max_phase_a', 'max_total_kw', 'auto_shed']) {
    assert.equal(VC({ writes: { [`global.dsm.${key}`]: '1' } }).ok, true, `${key} should be accepted`);
  }
  assert.equal(VC({ writes: { 'global.dsm.max_voltage': '240' } }).ok, false);
});

test('a key outside global.schedule/trigger/dsm is rejected', () => {
  for (const key of ['schedule.l1.on', 'global.command.l1', 'global.readings.co1']) {
    const r = VC({ writes: { [key]: 'x' } });
    assert.equal(r.ok, false, `accepted unrecognized key: ${key}`);
  }
});

test('a non-object writes value is rejected before any key is read', () => {
  for (const writes of [null, undefined, [], 'x', 42]) {
    const r = VC({ writes });
    assert.equal(r.ok, false, `accepted writes=${JSON.stringify(writes)}`);
  }
});

test('an empty writes object is rejected — a save with nothing pending is a caller bug, not a valid request', () => {
  const r = VC({ writes: {} });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'empty_writes');
});

test('one invalid key fails the whole batch — validated before any write is applied', () => {
  const r = VC({ writes: { 'global.trigger.care_acu_on': '28', 'global.trigger.bogus': '1' } });
  assert.equal(r.ok, false);
});

// ---------------------------------------------------------------------------
// ACU setpoint.
//
// The aircon is IR-commanded and its logic takes a code, not a relay state: "OFF" or a
// temperature "16".."30". An on/off-only command could therefore only ever mean "on at
// whatever temperature the last person picked", which is not something a UI can honestly
// show. `target_c` carries the setpoint for exactly the one class that has one.
// ---------------------------------------------------------------------------

test('an ACU command may carry a setpoint', () => {
  const r = validateCommand({ device_id: 'acu_main', action: 'on', target_c: 24 }, DEVICE_REGISTRY);
  assert.equal(r.ok, true);
  assert.equal(r.cmd.target_c, 24);
});

test('an ACU command without a setpoint is still valid — off needs none', () => {
  const r = validateCommand({ device_id: 'acu_main', action: 'off' }, DEVICE_REGISTRY);
  assert.equal(r.ok, true);
  assert.equal(r.cmd.target_c, undefined);
});

test('the setpoint is bounded by what the IR library can actually emit', () => {
  for (const bad of [15, 31, 0, -5]) {
    const r = validateCommand({ device_id: 'acu_main', action: 'on', target_c: bad }, DEVICE_REGISTRY);
    assert.equal(r.ok, false, `${bad} must be rejected`);
    assert.equal(r.code, 'invalid_target_c');
  }
  for (const good of [16, 24, 30]) {
    assert.equal(validateCommand({ device_id: 'acu_main', action: 'on', target_c: good }, DEVICE_REGISTRY).ok, true);
  }
});

test('the setpoint must be a whole degree — the IR library has no half steps', () => {
  const r = validateCommand({ device_id: 'acu_main', action: 'on', target_c: 23.5 }, DEVICE_REGISTRY);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'invalid_target_c');
});

test('a setpoint on anything other than the ACU is rejected rather than ignored', () => {
  const r = validateCommand({ device_id: 'l1', action: 'on', target_c: 24 }, DEVICE_REGISTRY);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'target_c_not_applicable');
});
