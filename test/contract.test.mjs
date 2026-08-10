/**
 * Contract tests for the bridge layer (Phases A + B).
 *
 *     npm test
 *
 * These guard the two failure modes that would be most expensive to find later:
 *   1. the mock and the Node-RED bridge drifting apart, so the frontend works locally
 *      and breaks on the Pi;
 *   2. a control (write) path sneaking into what is meant to be a read-only Stage 1.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { DEVICE_REGISTRY, PHASE_MAP, publicDevices } from '../shared/registry.mjs';
import { buildLatest } from '../shared/buildLatest.mjs';

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
// read-only guarantees
// ---------------------------------------------------------------------------

test('the bridge exposes only GET endpoints', () => {
  const ins = flow.filter((n) => n.type === 'http in');
  assert.deepEqual(ins.map((n) => n.url).sort(), ['/api/devices', '/api/readings/history', '/api/readings/latest']);
  for (const n of ins) assert.equal(n.method, 'get', `${n.url} is not GET`);
});

test('the bridge contains no device-command or outbound-request nodes', () => {
  for (const forbidden of ['http request', 'tuya-smart-device', 'mqtt out', 'websocket in']) {
    assert.equal(flow.some((n) => n.type === forbidden), false, `found a ${forbidden} node`);
  }
});

test('collectors on existing tabs never write flow context', () => {
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
