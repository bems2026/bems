/**
 * Read-only health check for the iBEMS bridge — the exact "Against the Pi (Phase F)"
 * checklist from the implementation plan §6, pointed at a real host instead of the mock.
 * Makes zero writes; safe to run any time, deployed or not, as often as you like.
 *
 *     node node-red-bridge/verify.mjs --host=<pi-ip> [--port=1880] [--timeout=5000]
 *
 * Exit code 0 only if every check passes. Two things from plan §6 this script cannot
 * check remotely, printed as reminders at the end:
 *   - contextStorage surviving a restart (requires actually restarting Node-RED)
 *   - the settings.js edits themselves (this machine has no filesystem access to the Pi)
 */

import net from 'node:net';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};

const HOST = arg('host');
const PORT = Number(arg('port', 1880));
const TIMEOUT_MS = Number(arg('timeout', 5000));

if (!HOST) {
  console.error('Usage: node node-red-bridge/verify.mjs --host=<pi-ip> [--port=1880]');
  process.exit(2);
}

const BASE = `http://${HOST}:${PORT}`;
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function fetchWithTimeout(path, opts = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${BASE}${path}`, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function checkReachable() {
  try {
    await fetchWithTimeout('/');
    record('reachable', true, BASE);
    return true;
  } catch (e) {
    record('reachable', false, `${e.message} — is the Pi on this network, and is Node-RED running on :${PORT}?`);
    return false;
  }
}

async function checkDevices() {
  try {
    const res = await fetchWithTimeout('/api/devices');
    if (!res.ok) return record('GET /api/devices', false, `HTTP ${res.status}`), null;
    const body = await res.json();
    const ok = Array.isArray(body) && body.length > 0 && body.every((d) => d.id && d.class);
    record('GET /api/devices', ok, `${Array.isArray(body) ? body.length : 0} devices`);
    return ok ? body : null;
  } catch (e) {
    record('GET /api/devices', false, e.message);
    return null;
  }
}

async function checkLatest() {
  try {
    const res = await fetchWithTimeout('/api/readings/latest');
    if (!res.ok) return record('GET /api/readings/latest', false, `HTTP ${res.status}`), null;
    const body = await res.json();
    const totals = Array.isArray(body) && body.find((r) => r.device_id === '_totals');
    const ok = Array.isArray(body) && body.length > 0 && !!totals;
    record('GET /api/readings/latest', ok, `${Array.isArray(body) ? body.length : 0} rows${totals ? ', _totals present' : ', _totals MISSING'}`);
    if (totals) {
      console.log(`        totals: today=${totals.energy_kwh_today} power_w=${totals.total_power_w} phase_blue=${JSON.stringify(totals.phase_current?.blue)}`);
      if (totals.phase_current?.blue !== null) {
        record('phase_current.blue is null, not a number', false, `got ${JSON.stringify(totals.phase_current?.blue)} — no Blue-phase meter exists, this must never be a real number`);
      }
    }
    return body;
  } catch (e) {
    record('GET /api/readings/latest', false, e.message);
    return null;
  }
}

async function checkHistory(deviceId) {
  if (!deviceId) return record('GET /api/readings/history', false, 'skipped — no device id available from /api/devices');
  try {
    const res = await fetchWithTimeout(`/api/readings/history?device_id=${encodeURIComponent(deviceId)}&range=1h`);
    if (!res.ok) return record('GET /api/readings/history', false, `HTTP ${res.status}`);
    const body = await res.json();
    const ok = body && body.device_id === deviceId && Array.isArray(body.points);
    const note =
      body?.points?.length === 0
        ? '0 points — correct on a freshly deployed bridge, the ring buffer fills at 1 point/min'
        : `${body.points.length} points`;
    record('GET /api/readings/history', ok, note);
  } catch (e) {
    record('GET /api/readings/history', false, e.message);
  }
}

// --- minimal RFC 6455 client: connect, wait for one text frame, disconnect ---
function checkWebSocket() {
  return new Promise((resolve) => {
    const key = crypto.randomBytes(16).toString('base64');
    const socket = net.connect(PORT, HOST);
    let buf = Buffer.alloc(0);
    let handshook = false;
    let done = false;

    const finish = (ok, detail) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      record('WS /ws/live', ok, detail);
      socket.destroy();
      resolve();
    };

    const timer = setTimeout(() => finish(false, `no frame within ${TIMEOUT_MS}ms`), TIMEOUT_MS);

    socket.on('error', (e) => finish(false, e.message));
    socket.on('connect', () => {
      socket.write(
        `GET /ws/live HTTP/1.1\r\nHost: ${HOST}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!handshook) {
        const i = buf.indexOf('\r\n\r\n');
        if (i < 0) return;
        const status = buf.subarray(0, i).toString().split('\r\n')[0];
        if (!/101/.test(status)) return finish(false, `handshake failed: ${status}`);
        buf = buf.subarray(i + 4);
        handshook = true;
      }
      if (buf.length >= 2) {
        const op = buf[0] & 0x0f;
        if (op === 1) finish(true, 'received a frame');
      }
    });
  });
}

async function main() {
  console.log(`Verifying iBEMS bridge at ${BASE}\n`);

  if (!(await checkReachable())) {
    printSummary();
    process.exit(1);
  }

  const devices = await checkDevices();
  await checkLatest();
  const firstOutlet = devices?.find((d) => d.class === 'outlet_dual')?.id ?? devices?.[0]?.id;
  await checkHistory(firstOutlet);
  await checkWebSocket();

  printSummary();
}

function printSummary() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  console.log('\nNot checked by this script (need Pi filesystem/console access, not just network reachability):');
  console.log('  - contextStorage surviving a Node-RED restart (docs/bridge-contract.md §Deployment)');
  console.log('  - the settings.js edits themselves — this only observes their effects over HTTP');
  process.exitCode = failed.length ? 1 : 0;
}

main();
