/**
 * Contract-identical local fake of the Node-RED bridge.
 *
 *     node mock-bridge/server.mjs [--port=1880] [--500] [--drop-ws] [--stale=co3]
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
 * Failure injection, for exercising the frontend's resilience paths:
 *   --500          every HTTP request returns 500
 *   --drop-ws      accept the socket, then close it after 5 s, repeatedly
 *   --stale=<id>   that device stops updating (online:false, frozen ts)
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { DEVICE_REGISTRY, PHASE_MAP, TIMING, publicDevices } from '../shared/registry.mjs';
import { buildLatest, iso8 } from '../shared/buildLatest.mjs';

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

// ---------------------------------------------------------------------------
// simulator — produces snapshots in the exact shape the Node-RED collectors emit
// ---------------------------------------------------------------------------
const started = Date.now();
const energyAcc = {}; // ctx -> kWh, monotonic
for (const d of DEVICE_REGISTRY) if (d.ctx) energyAcc[d.ctx] = 0;
let totals = { today: 0, week: 41.2, month: 183.6 };

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
  for (const ctx of Object.keys(energyAcc)) energyAcc[ctx] += (power(ctx, i++, t, occ) / 1000) * (1 / 3600);
}, 1000).unref?.();

let tick = 0;
function snapshot() {
  const t = Date.now();
  const occ = occupancy();
  tick++;

  const mk = (ctx, i, withTime) => {
    const stale = ctx === STALE_ID;
    const p = stale ? 0 : power(ctx, i, t, occ);
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

  const outletMeters = {};
  const status = {};
  for (let i = 1; i <= 7; i++) {
    outletMeters[`co${i}`] = mk(`co${i}`, i + 10, true);
    // socket 1 follows occupancy; socket 2 on a slower cycle, so the UI shows both states
    status[`CO${i}_1`] = occ > 0.3;
    status[`CO${i}_2`] = occ > 0.3 && (i + Math.floor(tick / 30)) % 3 !== 0;
  }

  const lights = {};
  for (let i = 1; i <= 7; i++) lights[`L${i}`] = occ > 0.3 && i !== 7;

  totals.today = Object.entries(energyAcc)
    .filter(([k]) => ['co_yel', 'lo_red', 'arec', 'lo_yel2'].includes(k))
    .reduce((a, [, v]) => a + v, 0);

  return {
    energy: { meters: energyMeters, totals: { today: totals.today, week: totals.week + totals.today, month: totals.month + totals.today } },
    outlet: { meters: outletMeters, state: { status } },
    switch: { state: lights },
    // 1dp, matching what a Tuya temp/humidity DPS yields after its /10 scaling.
    aircon: {
      state: {
        power: occ > 0.3,
        setTemp: 24,
        roomTemp: (25.4 + wobble(1, t, 0.6)).toFixed(1),
        humidity: (62 + wobble(2, t, 4)).toFixed(1),
        outTemp: (31.8 + wobble(3, t, 1.5)).toFixed(1),
      },
    },
  };
}

const latest = () => buildLatest(snapshot(), DEVICE_REGISTRY, PHASE_MAP, Date.now());

// ---------------------------------------------------------------------------
// history ring buffer — same semantics as the Node-RED one
// ---------------------------------------------------------------------------
const hist = new Map();
function sampleHistory() {
  for (const r of latest()) {
    if (r.device_id === '_totals' || typeof r.power_w !== 'number') continue;
    const buf = hist.get(r.device_id) || [];
    buf.push({ ts: r.ts, power_w: r.power_w });
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
      buf.push({ ts: iso8(ms), power_w: Math.round((idle + (peak - idle) * occ + wobble(i % 17, ms, peak * 0.08)) * 10) / 10 });
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (FAIL_500) return send(res, 500, { error: 'injected failure (--500)' });
  if (req.method !== 'GET') return send(res, 405, { error: 'read-only bridge: GET only' });

  switch (url.pathname) {
    case '/api/devices':
      return send(res, 200, publicDevices());

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
  const inject = [FAIL_500 && '--500', DROP_WS && '--drop-ws', STALE_ID && `--stale=${STALE_ID}`].filter(Boolean);
  console.log(`iBEMS mock bridge  http://localhost:${PORT}`);
  console.log(`  GET  /api/devices              ${DEVICE_REGISTRY.length} devices`);
  console.log(`  GET  /api/readings/latest      ${DEVICE_REGISTRY.length + 1} rows (incl. _totals)`);
  console.log(`  GET  /api/readings/history     ?device_id=co3&range=24h`);
  console.log(`  WS   /ws/live                  push every ${TIMING.WS_PUSH_MS / 1000}s`);
  if (inject.length) console.log(`  failure injection: ${inject.join(' ')}`);
});
