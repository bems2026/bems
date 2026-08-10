/**
 * Generates `bridge-flow.json` from `shared/registry.mjs`.
 *
 *     node node-red-bridge/build-flow.mjs
 *
 * Why a generator instead of a hand-written flow file: the device registry would
 * otherwise have to be duplicated between the mock bridge and the Node-RED function
 * nodes, and the two would drift. Here there is exactly one registry.
 *
 * ---------------------------------------------------------------------------
 * ARCHITECTURE NOTE — why this touches the four existing tabs
 *
 * Node-RED `flow` context is scoped to a single tab. The live BEMS state is spread
 * across four independent flow contexts:
 *
 *   Energy Monitoring - Set time : co_yel/lo_red/arec/lo_yel2 readings + bems_energy_*
 *   Outlet                       : co1..co7 readings + bems_outlets_state
 *   Switch                       : bems_lights_state
 *   Aircon                       : ac_dash_state
 *
 * A function node on a new bridge tab therefore CANNOT read any of them. There is no
 * supported cross-flow context read in a function node.
 *
 * So each source tab gets a 3-node read-only collector:
 *
 *   [link in: bridge/collect/<tab>] -> [function: reads its own flow ctx] -> [link out: return]
 *
 * These are pure readers. They never call flow.set(), never touch a device, and are
 * not wired to any existing node — nothing on those tabs is modified or rerouted.
 * The bridge tab chains four `link call`s to gather all four snapshots into one msg.
 * ---------------------------------------------------------------------------
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DEVICE_REGISTRY, PHASE_MAP, TIMING, publicDevices } from '../shared/registry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'bridge-flow.json');

/**
 * The payload transform is inlined from `shared/buildLatest.mjs` rather than
 * rewritten here, so the Node-RED bridge and the mock bridge run the identical
 * implementation. Stripping `export ` is the only edit made to it.
 */
const BUILD_LATEST_SRC = readFileSync(join(HERE, '..', 'shared', 'buildLatest.mjs'), 'utf8')
  .replace(/^export /gm, '');

/** Tab ids of the live flow. Verified against flows.json — do not invent these. */
const SOURCE_TABS = {
  energy: { z: '12a0ea5e7b516a4c', label: 'Energy Monitoring - Set time' },
  outlet: { z: 'ac87d748b5788895', label: 'Outlet' },
  switch: { z: '8550151b1adeabd1', label: 'Switch' },
  aircon: { z: '1715dabc6d837b3b', label: 'Aircon' },
};

const BRIDGE_TAB = 'b41d9e0000000001';
const WS_CFG = 'b41d9effffff0001';
let seq = 0;
/**
 * Deterministic 16-hex ids so regenerating produces a stable diff.
 * Prefix `b41dc0` deliberately differs from BRIDGE_TAB/WS_CFG's `b41d9e` so a
 * generated node can never collide with a fixed id.
 */
const nid = () => 'b41dc0' + String(++seq).padStart(10, '0');

// ---------------------------------------------------------------------------
// Shared JS injected into function nodes
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Collector nodes (one triple per source tab)
// ---------------------------------------------------------------------------

const COLLECTORS = {
  energy: `
// READ-ONLY. Reads this tab's flow context; writes nothing.
const keys = ['co_yel', 'lo_red', 'arec', 'lo_yel2'];
const meters = {};
for (const k of keys) {
  meters[k] = {
    v: flow.get(k + '_last_v'), c: flow.get(k + '_last_c'), p: flow.get(k + '_last_p'),
    e: flow.get(k + '_energy'), h: flow.get(k + '_health')
  };
}
msg.snapshot = msg.snapshot || {};
msg.snapshot.energy = {
  meters,
  totals: {
    today: flow.get('bems_energy_today'),
    week: flow.get('bems_energy_week'),
    month: flow.get('bems_energy_month')
  }
};
return msg;`,

  outlet: `
// READ-ONLY. Reads this tab's flow context; writes nothing.
const meters = {};
for (let i = 1; i <= 7; i++) {
  const k = 'co' + i;
  meters[k] = {
    v: flow.get(k + '_last_v'), c: flow.get(k + '_last_c'), p: flow.get(k + '_last_p'),
    e: flow.get(k + '_energy'), h: flow.get(k + '_health'), t: flow.get(k + '_last_time')
  };
}
msg.snapshot = msg.snapshot || {};
msg.snapshot.outlet = { meters, state: flow.get('bems_outlets_state') || {} };
return msg;`,

  switch: `
// READ-ONLY. Reads this tab's flow context; writes nothing.
msg.snapshot = msg.snapshot || {};
msg.snapshot.switch = { state: flow.get('bems_lights_state') || {} };
return msg;`,

  aircon: `
// READ-ONLY. Reads this tab's flow context; writes nothing.
msg.snapshot = msg.snapshot || {};
msg.snapshot.aircon = { state: flow.get('ac_dash_state') || {} };
return msg;`,
};

// ---------------------------------------------------------------------------
// Build latest readings — the one code path behind /api/readings/latest and /ws/live
// ---------------------------------------------------------------------------

const BUILD_LATEST = `
${BUILD_LATEST_SRC}

const REG = ${JSON.stringify(DEVICE_REGISTRY)};
const PHASE_MAP = ${JSON.stringify(PHASE_MAP)};

msg.payload = buildLatest(msg.snapshot || {}, REG, PHASE_MAP, Date.now());
msg.headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
return msg;`;

const SERVE_DEVICES = `
msg.payload = ${JSON.stringify(publicDevices())};
msg.headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
return msg;`;

const SERVE_HISTORY = `
const REG = ${JSON.stringify(DEVICE_REGISTRY.map((d) => d.id))};
const RANGES = { '1h': 1, '6h': 6, '24h': 24 };

const q = (msg.req && msg.req.query) || {};
const id = q.device_id;
const range = RANGES[q.range] ? q.range : '24h';

msg.headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

if (!id) {
  msg.statusCode = 400;
  msg.payload = { error: 'device_id is required' };
  return msg;
}
if (REG.indexOf(id) === -1) {
  msg.statusCode = 404;
  msg.payload = { error: 'unknown device_id: ' + id };
  return msg;
}

const cutoff = Date.now() - RANGES[range] * 3600 * 1000;
const buf = flow.get('hist_' + id) || [];
// An empty buffer is correct on a fresh start, not an error — it fills at 1 point/min.
msg.statusCode = 200;
msg.payload = {
  device_id: id,
  range,
  points: buf.filter(p => Date.parse(p.ts) >= cutoff)
};
return msg;`;

const APPEND_HISTORY = `
// Ring buffer. Required because no 24h history exists anywhere in the live flow:
// the *_arr_* keys are 3-minute averaging buffers that get emptied each cycle, and
// the ui_chart nodes' 12h window is locked inside the dashboard with no API.
// NOTE: worthless unless settings.js enables contextStorage.localfilesystem —
// otherwise this is memory-only and a restart wipes it.
const CAP = ${TIMING.HISTORY_MAX_POINTS};
const rows = Array.isArray(msg.payload) ? msg.payload : [];
for (const r of rows) {
  if (r.device_id === '_totals') continue;
  if (typeof r.power_w !== 'number') continue;
  const key = 'hist_' + r.device_id;
  const buf = flow.get(key) || [];
  buf.push({ ts: r.ts, power_w: r.power_w });
  if (buf.length > CAP) buf.splice(0, buf.length - CAP);
  flow.set(key, buf);
}
return null;`;

const WS_SERIALIZE = `
msg.payload = JSON.stringify(msg.payload);
return msg;`;

// ---------------------------------------------------------------------------
// Node builders
// ---------------------------------------------------------------------------

const fn = (z, name, func, x, y, wires = [[]], outputs = 1) => ({
  id: nid(), type: 'function', z, name, func, outputs, timeout: 0,
  noerr: 0, initialize: '', finalize: '', libs: [], x, y, wires,
});
const linkIn = (z, name, x, y, wires) => ({ id: nid(), type: 'link in', z, name, links: [], x, y, wires });
const linkOutReturn = (z, x, y) => ({ id: nid(), type: 'link out', z, name: '', mode: 'return', links: [], x, y, wires: [] });
const linkCall = (z, name, target, x, y, wires) => ({
  id: nid(), type: 'link call', z, name, links: [target], linkType: 'static', timeout: '30', x, y, wires,
});
const httpIn = (z, name, url, x, y, wires) => ({
  id: nid(), type: 'http in', z, name, url, method: 'get', upload: false, swaggerDoc: '', x, y, wires,
});
const httpRes = (z, x, y) => ({ id: nid(), type: 'http response', z, name: '', statusCode: '', headers: {}, x, y, wires: [] });
const inject = (z, name, repeat, x, y, wires) => ({
  id: nid(), type: 'inject', z, name, props: [{ p: 'payload' }], repeat: String(repeat),
  crontab: '', once: true, onceDelay: '2', topic: '', payload: '', payloadType: 'date', x, y, wires,
});

// ---------------------------------------------------------------------------
// Assemble
// ---------------------------------------------------------------------------

const nodes = [];

nodes.push({
  id: BRIDGE_TAB, type: 'tab', label: 'iBEMS Bridge (Stage 1, read-only)', disabled: false,
  info: [
    '# iBEMS Stage 1 bridge — READ ONLY',
    '',
    'Generated by `node-red-bridge/build-flow.mjs`. Do not hand-edit; regenerate.',
    '',
    'Serves GET /api/devices, /api/readings/latest, /api/readings/history and WS /ws/live.',
    'There are no POST endpoints and none may be added — control is Stage 2.',
    '',
    'Requires in settings.js: contextStorage.localfilesystem (otherwise the history',
    'ring buffer and all energy accumulators are wiped on every restart).',
    '',
    'Depends on 4 read-only collector node triples added to the existing tabs, because',
    'Node-RED flow context is per-tab and this state lives in 4 separate contexts.',
    '',
    'Do NOT port-forward port 1880: no adminAuth, no httpNodeAuth, and flows.json',
    'holds every Tuya deviceKey in plaintext. BEMS LAN only.',
  ].join('\n'),
  env: [],
});

// --- collector triples on the four source tabs ------------------------------
const collectorLinkIds = {};
let cy = 80;
for (const [key, tab] of Object.entries(SOURCE_TABS)) {
  const out = linkOutReturn(tab.z, 700, cy);
  const f = fn(tab.z, `Bridge collect: ${tab.label}`, COLLECTORS[key].trim(), 480, cy, [[out.id]]);
  const li = linkIn(tab.z, `bridge/collect/${key}`, 280, cy, [[f.id]]);
  collectorLinkIds[key] = li.id;
  nodes.push(li, f, out);
  cy += 60;
}

// --- the single read path ---------------------------------------------------
const readOut = linkOutReturn(BRIDGE_TAB, 1180, 200);
const buildFn = fn(BRIDGE_TAB, 'Build latest readings', BUILD_LATEST.trim(), 990, 200, [[readOut.id]]);
const cAir = linkCall(BRIDGE_TAB, 'collect aircon', collectorLinkIds.aircon, 820, 200, [[buildFn.id]]);
const cSw = linkCall(BRIDGE_TAB, 'collect switch', collectorLinkIds.switch, 660, 200, [[cAir.id]]);
const cOut = linkCall(BRIDGE_TAB, 'collect outlet', collectorLinkIds.outlet, 500, 200, [[cSw.id]]);
const cEn = linkCall(BRIDGE_TAB, 'collect energy', collectorLinkIds.energy, 340, 200, [[cOut.id]]);
const readIn = linkIn(BRIDGE_TAB, 'bridge/read-latest', 180, 200, [[cEn.id]]);
nodes.push(readIn, cEn, cOut, cSw, cAir, buildFn, readOut);

// --- GET /api/devices -------------------------------------------------------
const devRes = httpRes(BRIDGE_TAB, 640, 320);
const devFn = fn(BRIDGE_TAB, 'Serve devices', SERVE_DEVICES.trim(), 440, 320, [[devRes.id]]);
nodes.push(httpIn(BRIDGE_TAB, 'GET /api/devices', '/api/devices', 220, 320, [[devFn.id]]), devFn, devRes);

// --- GET /api/readings/latest ----------------------------------------------
const latRes = httpRes(BRIDGE_TAB, 640, 380);
const latCall = linkCall(BRIDGE_TAB, '', readIn.id, 460, 380, [[latRes.id]]);
nodes.push(httpIn(BRIDGE_TAB, 'GET /api/readings/latest', '/api/readings/latest', 220, 380, [[latCall.id]]), latCall, latRes);

// --- GET /api/readings/history ---------------------------------------------
const hisRes = httpRes(BRIDGE_TAB, 640, 440);
const hisFn = fn(BRIDGE_TAB, 'Serve history', SERVE_HISTORY.trim(), 440, 440, [[hisRes.id]]);
nodes.push(httpIn(BRIDGE_TAB, 'GET /api/readings/history', '/api/readings/history', 220, 440, [[hisFn.id]]), hisFn, hisRes);

// --- WS /ws/live ------------------------------------------------------------
const wsOut = { id: nid(), type: 'websocket out', z: BRIDGE_TAB, name: '', server: WS_CFG, client: '', x: 800, y: 520, wires: [] };
const wsSer = fn(BRIDGE_TAB, 'Serialize for WS', WS_SERIALIZE.trim(), 620, 520, [[wsOut.id]]);
const wsCall = linkCall(BRIDGE_TAB, '', readIn.id, 460, 520, [[wsSer.id]]);
nodes.push(
  inject(BRIDGE_TAB, `push ${TIMING.WS_PUSH_MS / 1000}s`, TIMING.WS_PUSH_MS / 1000, 240, 520, [[wsCall.id]]),
  wsCall, wsSer, wsOut,
  { id: WS_CFG, type: 'websocket-listener', path: '/ws/live', wholemsg: 'false' },
);

// --- history ring buffer ----------------------------------------------------
const ringFn = fn(BRIDGE_TAB, 'Append to history ring', APPEND_HISTORY.trim(), 640, 600, [[]]);
const ringCall = linkCall(BRIDGE_TAB, '', readIn.id, 460, 600, [[ringFn.id]]);
nodes.push(
  inject(BRIDGE_TAB, `sample ${TIMING.HISTORY_SAMPLE_MS / 1000}s`, TIMING.HISTORY_SAMPLE_MS / 1000, 240, 600, [[ringCall.id]]),
  ringCall, ringFn,
);

writeFileSync(OUT, JSON.stringify(nodes, null, 2) + '\n');

const onBridge = nodes.filter((n) => n.z === BRIDGE_TAB).length;
const onSource = nodes.filter((n) => n.z && n.z !== BRIDGE_TAB).length;
console.log(`wrote ${OUT}`);
console.log(`  ${nodes.length} nodes total — ${onBridge} on the new bridge tab, ${onSource} read-only collectors on existing tabs`);
console.log(`  ${DEVICE_REGISTRY.length} devices, WS every ${TIMING.WS_PUSH_MS / 1000}s, history every ${TIMING.HISTORY_SAMPLE_MS / 1000}s (cap ${TIMING.HISTORY_MAX_POINTS})`);
