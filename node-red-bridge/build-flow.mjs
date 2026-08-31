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
import { DEVICE_REGISTRY, PHASE_MAP, STALE_AFTER_MS_BY_CLASS, TIMING, publicDevices, SITE } from '../shared/registry.mjs';
import { TRACK_ARRIVALS_SRC } from './arrivalTracker.mjs';

/** Devices that report an energy counter — the only ones the accumulator has anything to
 * accumulate for. Derived from the registry, never hand-listed. */
const METERED_IDS = DEVICE_REGISTRY.filter((d) => d.ctx).map((d) => d.id);

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'bridge-flow.json');

/**
 * The payload transform is inlined from `shared/buildLatest.mjs` rather than
 * rewritten here, so the Node-RED bridge and the mock bridge run the identical
 * implementation. Stripping `export ` is the only edit made to it.
 */
const BUILD_LATEST_SRC = readFileSync(join(HERE, '..', 'shared', 'buildLatest.mjs'), 'utf8')
  // Normalize CRLF -> LF before anything else: on a Windows checkout with core.autocrlf=true,
  // this file is CRLF on disk. Embedding that raw would bake real CR bytes into a Node-RED
  // function body meant to run on the Linux Pi, and would make this output depend on which
  // OS/git config generated it — the opposite of the "stable diff regardless of who runs
  // this" goal the deterministic node-id counter below already commits to.
  .replace(/\r\n/g, '\n')
  .replace(/^export /gm, '');

/**
 * Tab ids of the live flow. Verified against the real Pi's ~/.node-red/flows.json on
 * 2026-08-10, over SSH (bems@100.73.48.96) — NOT the same ids as a dev-machine copy of
 * this file would have. Same four tab labels, entirely different ids; this is exactly
 * the mismatch deploy.mjs's tab-verification check exists to catch. Don't reuse ids from
 * any other copy of flows.json without re-verifying against the actual deploy target.
 */
const SOURCE_TABS = {
  energy: { z: 'b91949ed325c0ab6', label: 'Energy Monitoring - Set time' },
  outlet: { z: 'f034cec8ea750f69', label: 'Outlet' },
  switch: { z: '5ba0bb77c042d889', label: 'Switch' },
  aircon: { z: '5ae2a6bf87435d7a', label: 'Aircon' },
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
    e: flow.get(k + '_energy'), h: flow.get(k + '_health'),
    // Sample-buffer depth. This tab appends one entry per message and drains the buffer on a
    // five-minute cycle, so the number moves whenever the meter is reporting — including when
    // the measured values do not, which is the case that matters. It is the ONLY arrival
    // signal this tab exposes: unlike the outlet tab it writes no timestamp anywhere.
    n: (flow.get(k + '_arr_v') || []).length
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
// READ-ONLY. Reads this tab's flow context and global context; writes nothing.
// 'health' is global.lightStatus (set by the Lighting Logic Hub) — the real per-switch
// connection state, keyed '1'..'7'. buildLatest.mjs uses it to derive each switch's
// 'online' field instead of assuming always-online.
msg.snapshot = msg.snapshot || {};
msg.snapshot.switch = { state: flow.get('bems_lights_state') || {}, health: global.get('lightStatus') || {} };
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
const STALE_AFTER_MS_BY_CLASS = ${JSON.stringify(STALE_AFTER_MS_BY_CLASS)};

msg.payload = buildLatest(msg.snapshot || {}, REG, PHASE_MAP, Date.now(), ${SITE.utc_offset_minutes}, STALE_AFTER_MS_BY_CLASS);
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
  // voltage/current are recorded alongside power so Analytics can chart them over time,
  // not just as instantaneous values. Each is written ONLY when the poll actually carried
  // it — same "omitted, never zeroed" rule buildLatest follows, so a point predating this
  // change (or a meter that didn't report V/A) stays a gap in the chart rather than a
  // fabricated 0. Points already in the buffer keep power only; V/A accrues going forward.
  const p = { ts: r.ts, power_w: r.power_w };
  if (typeof r.voltage === 'number') p.voltage = r.voltage;
  if (typeof r.current === 'number') p.current = r.current;
  // Whether the device was actually reporting when this sample was taken (FI-010). Every
  // meter's last known wattage is carried forward into each sample, so without this a device
  // offline all day drew a confident flat line for hardware that was not reporting — the same
  // dishonesty already fixed for the 7d/30d charts. Written only when it is a real boolean, so
  // points from a bridge that never reported it stay unknown rather than being assumed online.
  if (typeof r.online === 'boolean') p.online = r.online;
  buf.push(p);
  if (buf.length > CAP) buf.splice(0, buf.length - CAP);
  flow.set(key, buf);
}
return null;`;

/**
 * Per-device weekly/monthly energy. Every meter reports only a DAILY counter that resets
 * at local midnight, and the building's own `bems_energy_week`/`_month` keys are
 * building-wide with no per-branch split — so anything longer than a day has to be
 * accumulated here, on OUR tab, from the daily counters as they roll over.
 *
 * Boundaries are explicit and local (+08:00): the week starts Monday, the month on the 1st.
 * These are almost certainly NOT the same boundaries the building's legacy flow uses for
 * its own week/month totals, so the per-branch figures are not expected to sum to those —
 * the UI states that rather than implying agreement.
 *
 * NOTE: like the history ring, this is worthless unless settings.js enables
 * contextStorage.localfilesystem — otherwise a restart wipes every accumulator and the
 * week/month figures silently restart from the current day.
 */
const ACCUMULATE_ENERGY = `
const rows = Array.isArray(msg.payload) ? msg.payload : [];
// Local wall-clock at the site's own UTC offset, matching iso8() — a UTC day boundary would
// fold the previous day in partway through the local morning, attributing hours to the wrong day.
const now = new Date(Date.now() + ${SITE.utc_offset_minutes} * 60000);
const y = now.getUTCFullYear();
const dayKey = y + '-' + (now.getUTCMonth() + 1) + '-' + now.getUTCDate();
const monthKey = y + '-' + (now.getUTCMonth() + 1);
// ISO-ish week key: Monday-start, identified by the Monday's own date.
const dow = (now.getUTCDay() + 6) % 7; // 0 = Monday
const monday = new Date(now.getTime() - dow * 86400000);
const weekKey = monday.getUTCFullYear() + '-' + (monday.getUTCMonth() + 1) + '-' + monday.getUTCDate();

for (const r of rows) {
  if (r.device_id === '_totals') continue;
  if (typeof r.energy_kwh_today !== 'number') continue;
  const key = 'enacc_' + r.device_id;
  const a = flow.get(key) || { lastToday: 0, weekBase: 0, monthBase: 0, weekKey: weekKey, monthKey: monthKey, dayKey: dayKey };

  if (a.weekKey !== weekKey) { a.weekBase = 0; a.weekKey = weekKey; }
  if (a.monthKey !== monthKey) { a.monthBase = 0; a.monthKey = monthKey; }

  if (a.dayKey !== dayKey) {
    // The day we were tracking has ended: its final counter value is a completed day.
    a.weekBase += a.lastToday;
    a.monthBase += a.lastToday;
    a.dayKey = dayKey;
    a.lastToday = 0;
  } else if (r.energy_kwh_today < a.lastToday) {
    // Counter went backwards inside the same day — a device reboot or a Tuya-side reset.
    // Whatever it had reached is still real consumption, so bank it rather than lose it.
    a.weekBase += a.lastToday;
    a.monthBase += a.lastToday;
  }

  a.lastToday = r.energy_kwh_today;
  flow.set(key, a);
}
return null;`;

/** Reads OUR OWN tab's accumulators into the snapshot. Unlike the building-tab collectors
 * this is plain flow.get on the bridge tab, so no link-call indirection is needed. */
const COLLECT_ENERGY_ACC = (ids) => `
const ids = ${JSON.stringify(ids)};
const acc = {};
for (const id of ids) {
  const a = flow.get('enacc_' + id);
  if (a) acc[id] = { weekBase: a.weekBase, monthBase: a.monthBase };
}
msg.snapshot = msg.snapshot || {};
msg.snapshot.energyAcc = acc;
return msg;`;

/**
 * Records WHEN each energy meter last showed evidence of reporting.
 *
 * Moved to `arrivalTracker.mjs` so it can be EXECUTED by a test rather than only inspected —
 * what ships is a source string injected into a Node-RED function node, and the correction it
 * carries (excluding the timer-integrated energy field) is exactly the kind that a
 * pattern-matching test would wave through. Its reasoning lives with it there.
 */
const TRACK_ARRIVALS = TRACK_ARRIVALS_SRC;

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
// Reads this tab's own energy accumulators into the snapshot, immediately before the build
// step consumes it. Not a link call: the keys live on THIS tab, not a building tab.
// Arrival tracking sits immediately before the build step and after every collector, because
// it needs the energy meters already in the snapshot and buildLatest needs its output.
const arrFn = fn(BRIDGE_TAB, 'Track meter arrivals', TRACK_ARRIVALS.trim(), 900, 320, [[buildFn.id]]);
const cAcc = fn(BRIDGE_TAB, 'collect energy accumulators', COLLECT_ENERGY_ACC(METERED_IDS).trim(), 900, 260, [[arrFn.id]]);
const cAir = linkCall(BRIDGE_TAB, 'collect aircon', collectorLinkIds.aircon, 820, 200, [[cAcc.id]]);
const cSw = linkCall(BRIDGE_TAB, 'collect switch', collectorLinkIds.switch, 660, 200, [[cAir.id]]);
const cOut = linkCall(BRIDGE_TAB, 'collect outlet', collectorLinkIds.outlet, 500, 200, [[cSw.id]]);
const cEn = linkCall(BRIDGE_TAB, 'collect energy', collectorLinkIds.energy, 340, 200, [[cOut.id]]);
const readIn = linkIn(BRIDGE_TAB, 'bridge/read-latest', 180, 200, [[cEn.id]]);
nodes.push(readIn, cEn, cOut, cSw, cAir, cAcc, arrFn, buildFn, readOut);

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
// One tick drives both the ring buffer and the energy accumulator: they consume the same
// snapshot, and sampling energy on a different cadence than power would make the two
// disagree about when a day ended.
const ringFn = fn(BRIDGE_TAB, 'Append to history ring', APPEND_HISTORY.trim(), 640, 600, [[]]);
const accFn = fn(BRIDGE_TAB, 'Accumulate energy', ACCUMULATE_ENERGY.trim(), 640, 660, [[]]);
const ringCall = linkCall(BRIDGE_TAB, '', readIn.id, 460, 600, [[ringFn.id, accFn.id]]);
nodes.push(
  inject(BRIDGE_TAB, `sample ${TIMING.HISTORY_SAMPLE_MS / 1000}s`, TIMING.HISTORY_SAMPLE_MS / 1000, 240, 600, [[ringCall.id]]),
  ringCall, ringFn, accFn,
);

writeFileSync(OUT, JSON.stringify(nodes, null, 2) + '\n');

const onBridge = nodes.filter((n) => n.z === BRIDGE_TAB).length;
const onSource = nodes.filter((n) => n.z && n.z !== BRIDGE_TAB).length;
console.log(`wrote ${OUT}`);
console.log(`  ${nodes.length} nodes total — ${onBridge} on the new bridge tab, ${onSource} read-only collectors on existing tabs`);
console.log(`  ${DEVICE_REGISTRY.length} devices, WS every ${TIMING.WS_PUSH_MS / 1000}s, history every ${TIMING.HISTORY_SAMPLE_MS / 1000}s (cap ${TIMING.HISTORY_MAX_POINTS})`);
