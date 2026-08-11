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
  switch: { state: { L1: true, L2: false } },
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
  const shared = readFileSync(join(ROOT, 'shared', 'buildLatest.mjs'), 'utf8').replace(/^export /gm, '');
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
