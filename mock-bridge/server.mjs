/**
 * Contract-identical local fake of the Node-RED bridge.
 *
 *     node mock-bridge/server.mjs [--port=1880] [--500] [--drop-ws] [--stale=co3]
 *                                  [--cmd-latency=800] [--cmd-fail=co3] [--cmd-drop=co3]
 *                                  [--dispatch=switch]
 *
 * Why this exists: the real Node-RED runs on a Raspberry Pi on the building LAN and is
 * not reachable from a dev machine. Without this, none of the frontend work in Phases
 * C–E could be built or verified at all.
 *
 * It imports `shared/buildLatest.mjs` — the exact same transform that
 * `build-flow.mjs` inlines into the Node-RED function node — so the payload shape here
 * cannot drift from the real bridge. Only the *snapshot* is synthetic.
 *
 * Zero dependencies (a minimal WebSocket server is implemented below) so it runs before
 * `npm install`. Retired at Stage 3 alongside the Node-RED bridge.
 *
 * Stage 2 (Phase L): `POST /api/command` — device control, MOCK ONLY. The Node-RED bridge
 * (`node-red-bridge/`) gains nothing from this; it stays byte-unchanged and read-only. See
 * `shared/commands.mjs`'s header and `docs/bridge-contract.md` for the full contract.
 *
 * Failure injection, for exercising the frontend's resilience paths:
 *   --500              every HTTP request returns 500 (GET and POST)
 *   --drop-ws          accept the socket, then close it after 5 s, repeatedly
 *   --stale=<id>       that device stops updating (online:false, frozen ts). Also accepts
 *                      a switch id (e.g. --stale=l3) — simulates that light's
 *                      global.lightStatus entry going DISCONNECTED, same as the real bridge.
 *   --cmd-latency=<ms> delay a command's mutation AND its ack by this long (default 0)
 *   --cmd-fail=<id|all> that command 502s; state is left untouched
 *   --dispatch=<classes>  comma-separated device classes GET /api/capabilities reports as
 *                         really reaching hardware (e.g. `--dispatch=switch` reproduces the
 *                         real Pi's lights-only state). Default: none, i.e. gate closed.
 *   --cmd-drop=<id|all> that command never responds at all (exercises the client's abort)
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { DEVICE_REGISTRY, PHASE_MAP, TIMING, publicDevices, SITE } from '../shared/registry.mjs';
import { buildLatest, iso8 } from '../shared/buildLatest.mjs';
import { COMMAND_ROUTE, ACCEPTED_STATUS, validateCommand, buildAck } from '../shared/commands.mjs';
import { CONTEXT_ROUTE, CONTEXT_ACCEPTED_STATUS, validateContextWrite, buildContextAck } from '../shared/context.mjs';

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const val = (n, d) => (argv.find((a) => a.startsWith(`--${n}=`)) || `--${n}=${d}`).split('=')[1];

const PORT = Number(val('port', 1880));
const FAIL_500 = flag('500');
const DROP_WS = flag('drop-ws');
const STALE_ID = val('stale', '');
const CMD_LATENCY = Number(val('cmd-latency', 0));
const CMD_FAIL = val('cmd-fail', '');
// Lets a frontend dev preview the mixed dispatch state (some classes live, some not) that
// only a real Pi with the gate open would otherwise produce. Same purpose as --cmd-fail
// above: make a state that needs hardware reachable without hardware.
const DISPATCH_CLASSES = val('dispatch', '') ? val('dispatch', '').split(',').filter(Boolean) : [];
const CMD_DROP = val('cmd-drop', '');

// ---------------------------------------------------------------------------
// simulator — produces snapshots in the exact shape the Node-RED collectors emit
// ---------------------------------------------------------------------------
const started = Date.now();
const energyAcc = {}; // ctx -> kWh, monotonic
for (const d of DEVICE_REGISTRY) if (d.ctx) energyAcc[d.ctx] = 0;
// Building baselines are derived from the per-device ones further down (see
// `seedBuildingBaselines`), not hardcoded: a mock whose building week total didn't roughly
// equal the sum of its own branches would look like an app bug rather than a fixture.
let totals = { today: 0, week: 0, month: 0 };

/** Deterministic per-device jitter so values look alive but reproducible. */
const wobble = (seed, t, amp) => Math.sin(t / 9000 + seed * 1.7) * amp;

/** Rough occupancy curve — drives how much load is on at a given hour. */
function occupancy() {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  if (h < 7 || h > 19) return 0.08;
  if (h < 9) return 0.45;
  if (h >= 12 && h < 13) return 0.55;
  return 0.9;
}

/** Steady-state power band per device, in watts: [idle, peak]. */
const BAND = {
  co1: [12, 210], co2: [8, 190], co3: [10, 420], co4: [15, 180],
  co5: [20, 140], co6: [6, 160], co7: [11, 230],
  co_yel: [90, 1400], lo_red: [60, 850], arec: [180, 2100], lo_yel2: [140, 1800],
};

const power = (ctx, i, t, occ) => {
  const [idle, peak] = BAND[ctx] || [5, 100];
  return Math.max(0, idle + (peak - idle) * occ + wobble(i, t, peak * 0.06));
};

/**
 * Per-device week/month baselines — the completed days a real bridge would already have
 * folded into its accumulators (`ACCUMULATE_ENERGY` in build-flow.mjs). The mock ships
 * them pre-seeded so the UI has something to show immediately; the real bridge starts at
 * zero and accrues a day at a time, which is the honest difference between a dev fixture
 * and a building that has only just been instrumented.
 *
 * Derived from each device's own power band rather than hardcoded, so a device's week and
 * month stay proportionate to the daily figure it actually generates.
 */
const energyBaseline = {};
for (const d of DEVICE_REGISTRY) {
  if (!d.ctx) continue;
  const [idle, peak] = BAND[d.ctx] || [5, 100];
  const typicalDay = (((idle + peak) / 2) * 24) / 1000; // kWh, rough mid-band day
  energyBaseline[d.id] = {
    weekBase: Math.round(typicalDay * 4 * 1000) / 1000, // ~4 completed days this week
    monthBase: Math.round(typicalDay * 19 * 1000) / 1000, // ~19 completed days this month
  };
}

/* The building's own week/month baselines are the sum of its four branch meters' — the
 * same set `totals.today` is summed from below. On the real Pi these two figures come from
 * different sources and can legitimately drift apart; in the mock they're kept consistent
 * so a discrepancy on screen means a real bug, not a fixture artefact. */
(function seedBuildingBaselines() {
  const BRANCH_CTX = ['co_yel', 'lo_red', 'arec', 'lo_yel2'];
  for (const d of DEVICE_REGISTRY) {
    if (!d.ctx || !BRANCH_CTX.includes(d.ctx)) continue;
    totals.week += energyBaseline[d.id].weekBase;
    totals.month += energyBaseline[d.id].monthBase;
  }
  totals.week = Math.round(totals.week * 100) / 100;
  totals.month = Math.round(totals.month * 100) / 100;
})();

/**
 * Commanded relay/switch state (Stage 2). `snapshot()` below *generates* a plausible
 * baseline from the occupancy curve on every call — there's no persistent state to mutate
 * by default. A command pins one key here, and the pin wins forever: a real relay stays
 * where you put it, and an expiring override would make the mock silently revert a toggle
 * a few seconds later, indistinguishable from the relay failing to hold — the single most
 * confusing failure this simulation could invent. Keys are the same topic strings the
 * legacy Node-RED flow used (`CO<n>_1`, `L<n>`) plus this contract's own `AC_POWER`.
 */
const commanded = new Map();
const pinned = (key, simulated) => (commanded.has(key) ? commanded.get(key) : simulated);

/** Read by the 1s energy-accrual loop below so kWh doesn't climb on an outlet whose
 * relays are commanded off — written fresh by every `snapshot()` call. Up to 1s of lag
 * versus a command landing mid-interval; irrelevant at this granularity. */
let lastGate = {};

/**
 * Energy accrues on a wall-clock timer, not inside snapshot(). snapshot() is called
 * once per HTTP request AND once per WS tick, so accumulating there would make today's
 * kWh a function of how often the dashboard was polled. Seeded to a plausible
 * mid-morning value so the totals cards aren't showing ~0.
 */
for (const ctx of Object.keys(energyAcc)) {
  const [idle, peak] = BAND[ctx] || [5, 100];
  energyAcc[ctx] = ((idle + peak) / 2 / 1000) * Math.max(0, new Date().getHours() - 7);
}
setInterval(() => {
  const t = Date.now(), occ = occupancy();
  let i = 0;
  for (const ctx of Object.keys(energyAcc)) {
    const gate = lastGate[ctx] ?? 1; // only co1..co7 are ever gated — see lastGate's comment
    energyAcc[ctx] += (power(ctx, i++, t, occ) * gate / 1000) * (1 / 3600);
  }
}, 1000).unref?.();

let tick = 0;
function snapshot() {
  const t = Date.now();
  const occ = occupancy();
  tick++;

  const mk = (ctx, i, withTime, gate = 1) => {
    const stale = ctx === STALE_ID;
    const p = stale ? 0 : power(ctx, i, t, occ) * gate;
    const v = stale ? 0 : 220 + wobble(i + 3, t, 3);
    const c = v > 0 ? p / v : 0;
    // Values mimic what a Tuya DPS actually yields after scaling: 1dp volts/watts,
    // 3dp amps. The live parsers emit these as .toFixed() strings, so do the same —
    // it exercises the bridge's string->number coercion rather than bypassing it.
    const m = {
      v: stale ? undefined : v.toFixed(1),
      c: stale ? undefined : c.toFixed(3),
      p: stale ? undefined : p.toFixed(1),
      e: energyAcc[ctx].toFixed(4),
      h: !stale,
    };
    if (withTime) m.t = stale ? started : t;
    return m;
  };

  const energyMeters = {};
  ['co_yel', 'lo_red', 'arec', 'lo_yel2'].forEach((k, i) => { energyMeters[k] = mk(k, i, false); });

  // Relay state first, then the meter that depends on it: an outlet with both sockets
  // commanded off draws (simulated) zero, one socket on draws about half, both on draws
  // full simulated load. `pinned()` makes a Stage 2 command stick; otherwise this is the
  // same occupancy-driven baseline as before.
  const status = {};
  const gateByOutlet = {};
  for (let i = 1; i <= 7; i++) {
    const s1 = pinned(`CO${i}_1`, occ > 0.3);
    const s2 = pinned(`CO${i}_2`, occ > 0.3 && (i + Math.floor(tick / 30)) % 3 !== 0);
    status[`CO${i}_1`] = s1;
    status[`CO${i}_2`] = s2;
    gateByOutlet[`co${i}`] = (s1 ? 0.5 : 0) + (s2 ? 0.5 : 0);
  }
  lastGate = gateByOutlet;

  const outletMeters = {};
  for (let i = 1; i <= 7; i++) outletMeters[`co${i}`] = mk(`co${i}`, i + 10, true, gateByOutlet[`co${i}`]);

  const lights = {};
  const lightHealth = {};
  for (let i = 1; i <= 7; i++) {
    lights[`L${i}`] = pinned(`L${i}`, occ > 0.3 && i !== 7);
    // Mirrors global.lightStatus's real shape (id/conn/on/lastSeen) closely enough for
    // buildLatest.mjs's purposes — only `conn` is actually read. `--stale=lN` simulates
    // that light's connection dropping, same lever `--stale=coN` gives metered devices.
    lightHealth[i] = { id: i, conn: `l${i}` === STALE_ID ? 'DISCONNECTED' : 'CONNECTED', on: lights[`L${i}`], lastSeen: new Date(t).toISOString() };
  }

  totals.today = Object.entries(energyAcc)
    .filter(([k]) => ['co_yel', 'lo_red', 'arec', 'lo_yel2'].includes(k))
    .reduce((a, [, v]) => a + v, 0);

  return {
    energy: { meters: energyMeters, totals: { today: totals.today, week: totals.week + totals.today, month: totals.month + totals.today } },
    // What the Node-RED `Accumulate energy` node maintains on the real bridge — completed
    // days only; buildLatest adds each device's live daily counter on top.
    energyAcc: energyBaseline,
    outlet: { meters: outletMeters, state: { status } },
    switch: { state: lights, health: lightHealth },
    // 1dp, matching what a Tuya temp/humidity DPS yields after its /10 scaling.
    aircon: {
      state: {
        power: pinned('AC_POWER', occ > 0.3),
        setTemp: 24,
        roomTemp: (25.4 + wobble(1, t, 0.6)).toFixed(1),
        humidity: (62 + wobble(2, t, 4)).toFixed(1),
        outTemp: (31.8 + wobble(3, t, 1.5)).toFixed(1),
      },
    },
  };
}

// The site's offset, same as the generated flow passes — the mock is contract-identical to
// the real bridge by construction, and a timestamp is part of the contract.
const latest = () => buildLatest(snapshot(), DEVICE_REGISTRY, PHASE_MAP, Date.now(), SITE.utc_offset_minutes);

// ---------------------------------------------------------------------------
// history ring buffer — same semantics as the Node-RED one
// ---------------------------------------------------------------------------
const hist = new Map();
function sampleHistory() {
  for (const r of latest()) {
    if (r.device_id === '_totals' || typeof r.power_w !== 'number') continue;
    const buf = hist.get(r.device_id) || [];
    // Mirrors the Node-RED buffer (build-flow.mjs's APPEND_HISTORY): V/A are stored only
    // when the reading actually carried them, so a missing value stays a gap, not a 0.
    const p = { ts: r.ts, power_w: r.power_w };
    if (typeof r.voltage === 'number') p.voltage = r.voltage;
    if (typeof r.current === 'number') p.current = r.current;
    buf.push(p);
    if (buf.length > TIMING.HISTORY_MAX_POINTS) buf.splice(0, buf.length - TIMING.HISTORY_MAX_POINTS);
    hist.set(r.device_id, buf);
  }
}
// Backfill 24h so charts have something to draw immediately. The real bridge starts
// empty and fills at 1 point/min; this is a dev convenience, not contract behaviour.
(function seedHistory() {
  const now = Date.now();
  for (const d of DEVICE_REGISTRY) {
    if (!d.ctx) continue;
    const [idle, peak] = BAND[d.ctx] || [5, 100];
    const buf = [];
    for (let i = TIMING.HISTORY_MAX_POINTS; i > 0; i--) {
      const ms = now - i * TIMING.HISTORY_SAMPLE_MS;
      const h = new Date(ms).getHours();
      const occ = h < 7 || h > 19 ? 0.08 : h < 9 ? 0.45 : 0.9;
      const power_w = Math.round((idle + (peak - idle) * occ + wobble(i % 17, ms, peak * 0.08)) * 10) / 10;
      // V/A are derived from the same synthetic power curve rather than rolled
      // independently, so seeded history stays internally consistent (P ≈ V × A at pf≈1)
      // — a chart of A must look like a scaled chart of W, or the mock would be teaching
      // the UI a relationship the real meters don't have.
      const voltage = Math.round((224 + wobble(i % 23, ms, 3)) * 10) / 10;
      buf.push({ ts: iso8(ms, SITE.utc_offset_minutes), power_w, voltage, current: Math.round((power_w / voltage) * 1000) / 1000 });
    }
    hist.set(d.id, buf);
  }
})();
setInterval(sampleHistory, TIMING.HISTORY_SAMPLE_MS).unref?.();

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const RANGES = { '1h': 1, '6h': 6, '24h': 24 };

const send = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    // Mirrors the httpNodeCors setting the Pi needs; in dev Vite proxies instead.
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(s),
  });
  res.end(s);
};

// ---------------------------------------------------------------------------
// Command (write) path — Stage 2, mock only. See shared/commands.mjs's header.
// ---------------------------------------------------------------------------
const MAX_BODY = 8 * 1024;

/** Hand-rolled JSON body reader — this file stays dependency-free (see the header comment). */
function readJsonBody(req, cb) {
  let done = false;
  const finish = (err, val) => {
    if (done) return;
    done = true;
    cb(err, val);
  };

  const ct = req.headers['content-type'];
  if (ct && !/^application\/json\b/i.test(ct)) {
    return finish({ status: 415, code: 'unsupported_media_type', error: `expected application/json, got ${ct}` });
  }

  let size = 0;
  const chunks = [];
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      finish({ status: 413, code: 'body_too_large', error: `body exceeds ${MAX_BODY} bytes` });
      req.destroy(); // triggers 'error' below; the `done` guard stops it double-firing
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw.trim()) return finish({ status: 400, code: 'malformed_json', error: 'empty request body' });
    try {
      finish(null, JSON.parse(raw));
    } catch (e) {
      finish({ status: 400, code: 'malformed_json', error: e.message });
    }
  });
  req.on('error', () => finish({ status: 400, code: 'malformed_json', error: 'request stream aborted' }));
}

/** command_id -> {ack}. A client retry (its own abort firing mid-latency, say) replays the
 * same command_id and gets the original ack back rather than operating the relay twice.
 * Bounded and pruned on insert — this process never restarts often enough to leak. */
const replay = new Map();
const REPLAY_CAP = 200;
function rememberReplay(commandId, ack) {
  if (replay.size >= REPLAY_CAP) replay.delete(replay.keys().next().value);
  replay.set(commandId, ack);
}

function handleCommand(req, res) {
  readJsonBody(req, (err, body) => {
    if (err) return send(res, err.status, { error: err.error, code: err.code });

    const v = validateCommand(body, DEVICE_REGISTRY);
    if (!v.ok) return send(res, v.status, { error: v.error, code: v.code });

    const cmd = { ...v.cmd, command_id: v.cmd.command_id || crypto.randomUUID() };

    const prior = replay.get(cmd.command_id);
    if (prior) return send(res, ACCEPTED_STATUS, prior);

    if (CMD_FAIL === 'all' || CMD_FAIL === cmd.device_id) {
      return send(res, 502, { error: `injected command failure (--cmd-fail=${CMD_FAIL})`, code: 'upstream_rejected' });
    }
    if (CMD_DROP === 'all' || CMD_DROP === cmd.device_id) return; // never respond — exercises the client's own abort

    const commit = () => {
      commanded.set(cmd.target, cmd.action === 'on');
      const ack = buildAck(cmd, Date.now());
      rememberReplay(cmd.command_id, ack);
      send(res, ACCEPTED_STATUS, ack);
    };

    // Delaying the mutation, not just the response, matters: if only the response were
    // delayed, the 2s WS push could already carry the new value before the ack lands, and
    // the client's "pending" UI state would never actually render — the exact path
    // --cmd-latency exists to exercise.
    if (CMD_LATENCY > 0) setTimeout(commit, CMD_LATENCY);
    else commit();
  });
}

// ---------------------------------------------------------------------------
// Context (write) path — Stage 2, mock only. See shared/context.mjs's header. Unlike
// commands, this is genuinely a plain key/value store: GET reads back exactly what POST
// wrote, so Automation's "Write to Node-RED context" round-trips within a session — the
// real bridge doesn't serve this route at all, matching the honest failure v4's own copy
// describes for a genuinely absent Stage 1 endpoint.
// ---------------------------------------------------------------------------
const contextStore = new Map();

function handleContextWrite(req, res) {
  readJsonBody(req, (err, body) => {
    if (err) return send(res, err.status, { error: err.error, code: err.code });

    const v = validateContextWrite(body, DEVICE_REGISTRY);
    if (!v.ok) return send(res, v.status, { error: v.error, code: v.code });

    for (const [key, value] of Object.entries(v.writes)) contextStore.set(key, value);
    send(res, CONTEXT_ACCEPTED_STATUS, buildContextAck(v.writes, Date.now()));
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (FAIL_500) return send(res, 500, { error: 'injected failure (--500)' });

  if (req.method === 'OPTIONS') {
    // CORS preflight. A cross-origin POST with Content-Type: application/json triggers
    // this; invisible in dev (Vite proxies same-origin) and would otherwise first appear
    // as an opaque CORS failure on a real LAN build.
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Max-Age': '600',
    });
    return res.end();
  }

  if (req.method === 'POST') {
    if (url.pathname === COMMAND_ROUTE) return handleCommand(req, res);
    if (url.pathname === CONTEXT_ROUTE) return handleContextWrite(req, res);
    res.setHeader('Allow', 'GET');
    return send(res, 405, { error: `no such write route: ${url.pathname}`, code: 'method_not_allowed' });
  }

  if (req.method !== 'GET') {
    return send(res, 405, { error: `method not allowed: ${req.method}`, code: 'method_not_allowed' });
  }

  switch (url.pathname) {
    case '/api/devices':
      return send(res, 200, publicDevices());

    // Contract parity with server/proxy.mjs's real (Phase 6/7) endpoint. Closed by default:
    // the mock has no hardware to reach, so a frontend dev pointed at it sees the same
    // "commanded, not yet dispatchable" UI the real gated proxy produces. --dispatch=<classes>
    // overrides that purely so the mixed state (lights live, outlets/ACU not) can be worked
    // on without a Pi — it changes only what this endpoint claims, never what the mock does
    // with a command, which has no hardware path either way.
    case '/api/capabilities':
      return send(res, 200, { hardware_dispatch_enabled: DISPATCH_CLASSES.length > 0, dispatch_classes: DISPATCH_CLASSES });

    case '/api/readings/latest':
      return send(res, 200, latest());

    case '/api/readings/history': {
      const id = url.searchParams.get('device_id');
      const range = RANGES[url.searchParams.get('range')] ? url.searchParams.get('range') : '24h';
      if (!id) return send(res, 400, { error: 'device_id is required' });
      if (!DEVICE_REGISTRY.some((d) => d.id === id)) return send(res, 404, { error: `unknown device_id: ${id}` });
      const cutoff = Date.now() - RANGES[range] * 3600 * 1000;
      return send(res, 200, { device_id: id, range, points: (hist.get(id) || []).filter((p) => Date.parse(p.ts) >= cutoff) });
    }

    case CONTEXT_ROUTE:
      return send(res, 200, Object.fromEntries(contextStore));

    case COMMAND_ROUTE:
      res.setHeader('Allow', 'POST');
      return send(res, 405, { error: 'GET /api/command is not a thing — POST a command', code: 'method_not_allowed' });

    default:
      return send(res, 404, { error: `no such route: ${url.pathname}` });
  }
});

// ---------------------------------------------------------------------------
// Minimal WebSocket server (RFC 6455, server->client text frames only).
// Hand-rolled to keep this file dependency-free; we only ever push, never read.
// ---------------------------------------------------------------------------
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const clients = new Set();

function encodeText(str) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 127;
    header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6);
  }
  return Buffer.concat([header, payload]);
}

server.on('upgrade', (req, socket) => {
  if (new URL(req.url, 'http://x').pathname !== '/ws/live') return socket.destroy();

  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  socket.setNoDelay(true);
  clients.add(socket);

  const drop = () => { clients.delete(socket); socket.destroy(); };
  socket.on('error', drop);
  socket.on('close', () => clients.delete(socket));
  // We never parse inbound frames; a close frame simply shows up as data.
  socket.on('data', (b) => { if ((b[0] & 0x0f) === 0x08) drop(); });

  if (DROP_WS) setTimeout(drop, 5000);
});

setInterval(() => {
  if (!clients.size) return;
  const frame = encodeText(JSON.stringify(latest()));
  for (const s of clients) { try { s.write(frame); } catch { clients.delete(s); } }
}, TIMING.WS_PUSH_MS).unref?.();

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use — an older mock is probably still running.`);
    console.error(`  That older process keeps serving STALE CODE, which looks like your edits doing nothing.`);
    console.error(`  Free it, then retry:  npm run mock:stop\n`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, () => {
  const inject = [
    FAIL_500 && '--500',
    DROP_WS && '--drop-ws',
    STALE_ID && `--stale=${STALE_ID}`,
    CMD_LATENCY > 0 && `--cmd-latency=${CMD_LATENCY}`,
    CMD_FAIL && `--cmd-fail=${CMD_FAIL}`,
    DISPATCH_CLASSES.length && `--dispatch=${DISPATCH_CLASSES.join(',')}`,
    CMD_DROP && `--cmd-drop=${CMD_DROP}`,
  ].filter(Boolean);
  console.log(`iBEMS mock bridge  http://localhost:${PORT}`);
  console.log(`  GET  /api/devices              ${DEVICE_REGISTRY.length} devices`);
  console.log(`  GET  /api/readings/latest      ${DEVICE_REGISTRY.length + 1} rows (incl. _totals)`);
  console.log(`  GET  /api/readings/history     ?device_id=co3&range=24h`);
  console.log(`  POST ${COMMAND_ROUTE}                mock-only device control (Stage 2)`);
  console.log(`  GET  ${CONTEXT_ROUTE}                mock-only Node-RED context store (Stage 2)`);
  console.log(`  POST ${CONTEXT_ROUTE}                write schedule/trigger/DSM keys (Stage 2)`);
  console.log(`  WS   /ws/live                  push every ${TIMING.WS_PUSH_MS / 1000}s`);
  if (inject.length) console.log(`  failure injection: ${inject.join(' ')}`);
});
