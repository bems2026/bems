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

import { DEVICE_REGISTRY, PHASE_MAP, publicDevices, SITE, BUILDING_METER_IDS } from '../shared/registry.mjs';
import { buildLatest } from '../shared/buildLatest.mjs';
import { COMMAND_ROUTE, ACCEPTED_STATUS, validateCommand, buildAck } from '../shared/commands.mjs';
import { roomTargetFloorC } from '../shared/sitePolicy.mjs';
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

/**
 * The aircon and the outside-temp sensor both read `ac_dash_state`, fed by the IR blaster.
 * Neither is a meter nor a switch, so both fell through to a hardcoded `online = true`.
 *
 * That is not a hypothetical. On site 2026-08-25 the `NBRIC IR Blaster` and `Outside Temp`
 * nodes were in a permanent 10-second `find() timed out` retry loop — they are not in the
 * Tuya cloud project and have never once connected (RM-016) — while the dashboard reported
 * both `acu_main` and `sens_outside_temp` as ONLINE, carrying no measurement at all. A
 * fabricated online is worse than a stale reading: a stale one at least happened.
 *
 * An empty `ac_dash_state` is sound evidence rather than an inference. The mock populates it
 * in full, and a working blaster writes it every poll, so empty means the path has never
 * reported in either environment that exists.
 */
test('the aircon and its sensor report offline on the placeholder object the flow really writes', () => {
  // THE SHAPE THAT MATTERS. Read off the live Pi 2026-08-25 via the Node-RED context API:
  // the flow does not leave `ac_dash_state` empty when the blaster is dead, it seeds a
  // placeholder. Every field is the literal "--" and power is the string "OFFLINE" — the
  // object is self-describing, and `num("--")` is undefined, so "carries a real number" is
  // the honest test. An earlier version of this fix checked `Object.keys(ac).length` and
  // passed its own tests while changing nothing in production, because emptiness was an
  // assumption rather than an observation.
  const snap = snapshot();
  snap.aircon = { state: { power: 'OFFLINE', setTemp: '--', roomTemp: '--', humidity: '--', outTemp: '--' } };
  const built = buildLatest(snap, DEVICE_REGISTRY, PHASE_MAP, 1786000000000);
  assert.equal(built.find((r) => r.device_id === 'acu_main').online, false);
  assert.equal(built.find((r) => r.device_id === 'sens_outside_temp').online, false);
});

test('a single real reading is enough to count as reporting', () => {
  // Partial data is still data. The blaster sends temperature and humidity on separate DPS,
  // so demanding all of them would report a half-working device as dead.
  const snap = snapshot();
  snap.aircon = { state: { power: 'OFFLINE', setTemp: '--', roomTemp: '--', humidity: '--', outTemp: '31.8' } };
  const built = buildLatest(snap, DEVICE_REGISTRY, PHASE_MAP, 1786000000000);
  assert.equal(built.find((r) => r.device_id === 'sens_outside_temp').online, true);
});

test('the aircon and its sensor report offline when nothing has ever fed ac_dash_state', () => {
  const snap = snapshot();
  snap.aircon = { state: {} };
  const built = buildLatest(snap, DEVICE_REGISTRY, PHASE_MAP, 1786000000000);
  assert.equal(built.find((r) => r.device_id === 'acu_main').online, false);
  assert.equal(built.find((r) => r.device_id === 'sens_outside_temp').online, false);
});

test('the aircon and its sensor stay online while the blaster is actually reporting', () => {
  // The default snapshot is a healthy blaster; this must not become a false negative.
  assert.equal(row('acu_main').online, true);
  assert.equal(row('sens_outside_temp').online, true);
});

test('a missing aircon key is treated the same as an empty one — absent is not "fine"', () => {
  const snap = snapshot();
  delete snap.aircon;
  const built = buildLatest(snap, DEVICE_REGISTRY, PHASE_MAP, 1786000000000);
  assert.equal(built.find((r) => r.device_id === 'acu_main').online, false);
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

/**
 * RM-027 — the site's own setpoint floor, layered on top of the hardware bound above.
 *
 * TWO DIFFERENT FACTS, and conflating them would be the bug. `ACU_MIN_C` is what the live
 * flow's IR library actually has codes for — a hardware capability, identical at every site.
 * The policy floor is what the building's operator permits, and here it comes from the
 * university's energy-efficiency policy quoted in the funded project plan ("not lower than
 * 25 degrees"). A different site has a different rule, or none.
 *
 * SINCE RM-068 IT IS NOT ENFORCED HERE AT ALL. The number is a statement about the ROOM, and
 * it is enforced where rules are written and where the closed loop decides. What this function
 * does is attach a WARNING, which rides on the command into the audit note — so the fact
 * survives instead of the command being refused. `ACU_MIN_C`/`ACU_MAX_C` remain the only hard
 * bound, because below them there is no IR code to send at all.
 */
test('the room-comfort policy WARNS about a low setpoint, and no longer refuses it', () => {
  // RM-068 reversed this deliberately. The number stopped being a bound on the commanded
  // setpoint and became the coldest ROOM TEMPERATURE an automatic rule may aim for, because the
  // setpoint is the lever a closed loop moves: a loop that may never ask for 22 cannot hold a
  // room at 24 on a hot afternoon, and a person who needs 18 for an hour had no way to ask.
  // The fact is not lost — it rides on the command and `server/proxy.mjs` writes it into the
  // audit note, so a below-policy setpoint is attributed rather than prevented.
  const r = validateCommand(
    { device_id: 'acu_main', action: 'on', target_c: 18 },
    DEVICE_REGISTRY,
    { acu_min_room_target_c: 25 },
  );
  assert.equal(r.ok, true);
  assert.equal(r.cmd.warnings[0].code, 'below_room_comfort_policy');
  assert.equal(r.cmd.warnings[0].floor, 25);
  assert.match(r.cmd.warnings[0].detail, /25/);
});

test('the LEGACY policy key is still honoured, for the length of the rename window', () => {
  // phase35 copies the value rather than moving it, and code deploys are a separate act from
  // migrations here — so a bundle may meet either key first.
  const r = validateCommand(
    { device_id: 'acu_main', action: 'on', target_c: 18 },
    DEVICE_REGISTRY,
    { acu_min_setpoint_c: 25 },
  );
  assert.equal(r.ok, true);
  assert.equal(r.cmd.warnings[0].floor, 25);
});

test('a command that trips no policy carries no warnings field at all', () => {
  // A relay ack, and an in-policy setpoint ack, must be byte-identical to what they always
  // were, so no existing reader meets a field it has never seen.
  const inPolicy = validateCommand({ device_id: 'acu_main', action: 'on', target_c: 26 }, DEVICE_REGISTRY, { acu_min_room_target_c: 25 });
  assert.equal('warnings' in inPolicy.cmd, false);
  const relay = validateCommand({ device_id: 'l1', action: 'on' }, DEVICE_REGISTRY, { acu_min_room_target_c: 25 });
  assert.equal('warnings' in relay.cmd, false);
});

test('a setpoint at the policy value exactly draws no warning — the bound is inclusive', () => {
  const r = validateCommand(
    { device_id: 'acu_main', action: 'on', target_c: 25 },
    DEVICE_REGISTRY,
    { acu_min_room_target_c: 25 },
  );
  assert.equal(r.ok, true);
  assert.equal('warnings' in r.cmd, false);
});

test('a site with no policy gets the hardware bound and nothing more', () => {
  const r = validateCommand({ device_id: 'acu_main', action: 'on', target_c: 18 }, DEVICE_REGISTRY, {});
  assert.equal(r.ok, true, 'an absent policy must not invent a floor');
});

test('omitting the policy argument entirely is the pre-RM-027 behaviour', () => {
  const r = validateCommand({ device_id: 'acu_main', action: 'on', target_c: 16 }, DEVICE_REGISTRY);
  assert.equal(r.ok, true);
});

test('a policy can narrow the hardware bound but never widen it', () => {
  // A policy floor of 10 must not make 10 commandable: the IR library has no code to send.
  const r = validateCommand(
    { device_id: 'acu_main', action: 'on', target_c: 10 },
    DEVICE_REGISTRY,
    { acu_min_setpoint_c: 10 },
  );
  assert.equal(r.ok, false);
  assert.equal(r.code, 'invalid_target_c', 'the hardware bound must be checked first');
});

test('the active site actually declares a room-comfort policy, so this is not dead configuration', () => {
  // Guards against the value being silently dropped from the site module: the whole feature is
  // worth nothing if the deployed site declares no policy. Read through `roomTargetFloorC` so
  // this keeps holding after the contract migration removes the legacy key.
  const floor = roomTargetFloorC(SITE.policy);
  assert.equal(typeof floor, 'number');
  const r = validateCommand(
    { device_id: 'acu_main', action: 'on', target_c: floor - 1 },
    DEVICE_REGISTRY,
    SITE.policy,
  );
  assert.equal(r.ok, true, 'accepted, because the policy is about the room');
  assert.equal(r.cmd.warnings[0].code, 'below_room_comfort_policy');
});

/**
 * FI-010 — the history ring records whether the device was actually reporting.
 *
 * Every meter's last known wattage is carried forward into each sample (that is the whole
 * point of "last known reading"), so a device offline all day still filled the 24h chart with
 * a confident flat line. The 7d/30d charts lost that blindness earlier; this is the same fix
 * one layer down, where the samples are written.
 *
 * The generated function is checked for behaviour rather than exact text: that it records the
 * flag, and that it records it CONDITIONALLY. An unconditional write would stamp `online:
 * undefined` onto points from a bridge that never reported it, turning "unknown" into a value
 * — and `pointValue` only suppresses on an explicit `false`, so the two halves have to agree.
 */
test('the history ring records `online` on each sample', () => {
  const ring = flow.find((n) => n.name === 'Append to history ring');
  assert.ok(ring, 'the ring buffer node must exist');
  assert.match(ring.func, /p\.online = r\.online/);
});

test('it records `online` only when the reading actually carried a boolean', () => {
  // "Unknown" and "offline" are different claims. Points buffered before this change have no
  // flag at all, and assuming them online would fabricate exactly what FI-010 set out to stop.
  const ring = flow.find((n) => n.name === 'Append to history ring');
  assert.match(ring.func, /typeof r\.online === 'boolean'/);
});

test('the ring still omits rather than zeroes the optional readings', () => {
  // The rule this file has followed since voltage/current were added. Restated here because
  // adding a fourth field is exactly when someone reaches for a default.
  const ring = flow.find((n) => n.name === 'Append to history ring');
  assert.equal(/p\.(voltage|current|online) = 0/.test(ring.func), false);
});

// ---------------------------------------------------------------------------
// RM-057 — the building's energy totals ARE the sum of its branch meters.
// ---------------------------------------------------------------------------

/**
 * ONE SOURCE OF TRUTH FOR CONSUMED ENERGY.
 *
 * Until RM-057 the three building totals came from `bems_energy_*` — the legacy flow's own
 * two-second integration of power — while the per-branch split came from each meter's own
 * register. Two derivations of the SAME four circuits, rendered side by side on two pages, and
 * they disagreed by a few tenths of a percent on a good day and by 5.4x during RM-053. The
 * operator reported it three times before it was taken as a design fault rather than a bug.
 *
 * Now the total is the sum of the branches, so the headline figure and the split cannot
 * disagree: it is the same arithmetic, done once.
 *
 * The legacy figure is still published, as `energy_kwh_*_integrated`. It is no longer the
 * headline, but it is the only INDEPENDENT measurement of the same circuits this system has, and
 * without it the disagreement guard RM-054 added would compare a number against itself.
 */
const withAllMetersReporting = (over = {}) => {
  const snap = snapshot();
  snap.energy.meters.lo_yel2 = { v: '219.0', c: '1.100', p: '240.0', e: '2.5000', h: true };
  return { ...snap, ...over };
};

test('the building total is the sum of the branch meters, not a separately integrated figure', () => {
  const built = buildLatest(withAllMetersReporting(), DEVICE_REGISTRY, PHASE_MAP, 1786000000000, 480, {}, undefined, {}, BUILDING_METER_IDS);
  const totals = built.find((r) => r.device_id === '_totals');
  // 3.11 (co_yel) + 5.0 (lo_red) + 9.0 (arec) + 2.5 (lo_yel2)
  assert.equal(totals.energy_kwh_today, 19.61);
  // And it is the same arithmetic the page does, which is the whole point.
  const branchSum = BUILDING_METER_IDS.reduce(
    (sum, id) => sum + built.find((r) => r.device_id === id).energy_kwh_today,
    0,
  );
  assert.ok(Math.abs(totals.energy_kwh_today - branchSum) < 1e-9, 'the headline and the split are one number');
});

test('the legacy integrated counter is still published, as the independent cross-check', () => {
  const built = buildLatest(withAllMetersReporting(), DEVICE_REGISTRY, PHASE_MAP, 1786000000000, 480, {}, undefined, {}, BUILDING_METER_IDS);
  const totals = built.find((r) => r.device_id === '_totals');
  assert.equal(totals.energy_kwh_today_integrated, 12.41);
  assert.equal(totals.energy_kwh_week_integrated, 61.88);
  assert.equal(totals.energy_kwh_month_integrated, 204.3);
});

test('a branch with no reading makes the total null, never a quietly smaller building', () => {
  // The default snapshot's `lo_yel2` reports nothing at all. Summing the other three would
  // publish a building total that is short by a whole circuit, with nothing on screen saying so
  // — the failure mode RM-047 and RM-053 both had.
  const built = buildLatest(snapshot(), DEVICE_REGISTRY, PHASE_MAP, 1786000000000, 480, {}, undefined, {}, BUILDING_METER_IDS);
  const totals = built.find((r) => r.device_id === '_totals');
  assert.equal(totals.energy_kwh_today, null);
  // The integrated figure is unaffected — it is measured elsewhere and still means something.
  assert.equal(totals.energy_kwh_today_integrated, 12.41);
});

test('week and month read "not counted yet" until every branch has an accumulated figure', () => {
  // A freshly deployed bridge has no `energyAcc` at all, so no branch has a week or a month.
  const built = buildLatest(withAllMetersReporting(), DEVICE_REGISTRY, PHASE_MAP, 1786000000000, 480, {}, undefined, {}, BUILDING_METER_IDS);
  const totals = built.find((r) => r.device_id === '_totals');
  assert.equal(totals.energy_kwh_week, null);
  assert.equal(totals.energy_kwh_month, null);
});

test('week and month are the sum of the branches once the accumulator has them all', () => {
  const snap = withAllMetersReporting({
    energyAcc: {
      mtr_co_yellow: { weekBase: 10, monthBase: 40 },
      mtr_lo_red: { weekBase: 20, monthBase: 80 },
      mtr_arec_acu: { weekBase: 30, monthBase: 120 },
      mtr_lo_yellow: { weekBase: 5, monthBase: 20 },
    },
  });
  const built = buildLatest(snap, DEVICE_REGISTRY, PHASE_MAP, 1786000000000, 480, {}, undefined, {}, BUILDING_METER_IDS);
  const totals = built.find((r) => r.device_id === '_totals');
  // Each branch's week is its banked base plus today: (10+3.11)+(20+5)+(30+9)+(5+2.5)
  assert.equal(totals.energy_kwh_week, 84.61);
  // And the month the same way: 260 banked across the four, plus today's 19.61.
  assert.equal(totals.energy_kwh_month, 279.61);
});

test('one branch missing its week leaves the building week null, not three-quarters of a building', () => {
  const snap = withAllMetersReporting({
    energyAcc: {
      mtr_co_yellow: { weekBase: 10, monthBase: 40 },
      mtr_lo_red: { weekBase: 20, monthBase: 80 },
      mtr_arec_acu: { weekBase: 30, monthBase: 120 },
      // mtr_lo_yellow has not completed a day yet
    },
  });
  const built = buildLatest(snap, DEVICE_REGISTRY, PHASE_MAP, 1786000000000, 480, {}, undefined, {}, BUILDING_METER_IDS);
  const totals = built.find((r) => r.device_id === '_totals');
  assert.equal(totals.energy_kwh_week, null);
  assert.equal(totals.energy_kwh_month, null);
});

test('a flow that names no building meters behaves exactly as it did before RM-057', () => {
  // An older deployed bridge passes nothing here. It must keep serving the legacy figure rather
  // than suddenly reporting null — the same rule `maxDailyKwh` follows for an undeclared bound.
  const built = buildLatest(withAllMetersReporting(), DEVICE_REGISTRY, PHASE_MAP, 1786000000000);
  const totals = built.find((r) => r.device_id === '_totals');
  assert.equal(totals.energy_kwh_today, 12.41);
  assert.equal(totals.energy_kwh_week, 61.88);
  assert.equal(totals.energy_kwh_month, 204.3);
});

// ---------------------------------------------------------------------------
// RM-058 — each branch carries its OWN second opinion.
// ---------------------------------------------------------------------------

/**
 * THE PER-BRANCH CROSS-CHECK, and it existed in the snapshot all along.
 *
 * `<ctx>_energy` is the legacy engine's two-second integration of THAT meter's power, reset at
 * local midnight — the same quantity as `energy_kwh_today`, derived the other way. `buildLatest`
 * already read it as the fallback when a meter has no register; it was never published, so the
 * only cross-check the frontend could make was building-wide.
 *
 * That is exactly why RM-056 hid: `mtr_arec_acu` was 38 % short against its own power over a
 * 36-minute window and the building-level shortfall was 6.7 %, under any threshold worth setting.
 * Six times louder at the branch than at the building.
 *
 * PUBLISHED ONLY WHEN IT IS A DIFFERENT NUMBER. An outlet has no cumulative register at all
 * (RM-047), so its `energy_kwh_today` IS this integrated value — emitting both would invite a
 * comparison of a number with itself and imply a second measurement that does not exist.
 */
test('a meter publishes its own integrated figure beside its register-derived one', () => {
  const snap = withAllMetersReporting();
  // Give co_yel a register, so the published reading comes from it and `e` is the other view.
  snap.energy.meters.co_yel.dp = { today_acc_energy1: 3.5 };
  const built = buildLatest(snap, DEVICE_REGISTRY, PHASE_MAP, 1786000000000, 480, {}, undefined, {}, BUILDING_METER_IDS);
  const row = built.find((r) => r.device_id === 'mtr_co_yellow');
  assert.equal(row.energy_kwh_today, 3.5, 'the register wins, as RM-052 established');
  assert.equal(row.energy_kwh_today_integrated, 3.11, "and `co_yel_energy` rides along as that meter's second opinion");
});

test('a meter with no register publishes no second opinion, because there is only one number', () => {
  // No `dp`, so `energy_kwh_today` already IS the integrated figure. Publishing it twice would
  // manufacture an agreement and invite a check that can never fail.
  const built = buildLatest(withAllMetersReporting(), DEVICE_REGISTRY, PHASE_MAP, 1786000000000, 480, {}, undefined, {}, BUILDING_METER_IDS);
  const row = built.find((r) => r.device_id === 'mtr_co_yellow');
  assert.equal(row.energy_kwh_today, 3.11);
  assert.equal('energy_kwh_today_integrated' in row, false);
});

test('an outlet never carries one — it has no register to disagree with', () => {
  const built = buildLatest(withAllMetersReporting(), DEVICE_REGISTRY, PHASE_MAP, 1786000000000, 480, {}, undefined, {}, BUILDING_METER_IDS);
  const row = built.find((r) => r.device_id === 'co1');
  assert.ok(typeof row.energy_kwh_today === 'number', 'the outlet still reports its energy');
  assert.equal('energy_kwh_today_integrated' in row, false);
});

test('the backstop still wins: a rejected register figure leaves no phantom second opinion', () => {
  // `maxDailyKwh` makes buildLatest fall back to the integrated value. The published reading is
  // then the integrated one, so a cross-check field would again compare a number with itself.
  const snap = withAllMetersReporting();
  snap.energy.meters.co_yel.dp = { today_acc_energy1: 3676 };
  const built = buildLatest(snap, DEVICE_REGISTRY, PHASE_MAP, 1786000000000, 480, {}, 100, {}, BUILDING_METER_IDS);
  const row = built.find((r) => r.device_id === 'mtr_co_yellow');
  assert.equal(row.energy_kwh_today, 3.11, 'fell back to the integrated figure');
  assert.equal('energy_kwh_today_integrated' in row, false);
});
