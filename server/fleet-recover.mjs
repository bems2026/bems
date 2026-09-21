#!/usr/bin/env node
/**
 * Restarts Node-RED when a device is reachable but its node has given up — RM-131.
 *
 *     node server/fleet-recover.mjs [--dry-run]
 *
 * Run by `ibems-fleet-recover.timer` every five minutes. Reads the live flow (which nodes, at
 * which addresses), the bridge's own online flags, and the LAN map; probes each offline node's
 * static address with one TCP connect on 6668 (no Tuya handshake, closed at once); hands the
 * observations to `fleetRecover.mjs`, which decides; and only then, with restraint, restarts
 * Node-RED. Every decision is logged, so the journal — persistent since RM-125 — explains every
 * restart this ever makes.
 *
 * What it will NOT do: touch the flow, dispatch anything, or restart for a device nothing can
 * reach. Those are the cases where a restart costs a minute of every session and buys nothing.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv, createAdminClient } from '../node-red-bridge/nodeRedAdmin.mjs';
import { registryIdForNodeName } from './cloudDispatchConfig.mjs';
import { DEVICE_REGISTRY } from '../shared/registry.mjs';
import { readLanMap } from './lanMap.mjs';
import { decideRecovery, driftedAddresses } from './fleetRecover.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
loadDotEnv(join(HERE, '..'));
loadDotEnv(HERE);

const DRY = process.argv.includes('--dry-run');
const STATE_PATH = join(HERE, 'data', 'fleet-recover.json');
const BRIDGE = 'http://127.0.0.1:1880';
const ANNOUNCED_WITHIN_MS = 15 * 60 * 1000;
const log = (m) => console.log(`[ibems-fleet-recover] ${m}`);

function readState() {
  try { return JSON.parse(readFileSync(STATE_PATH, 'utf8')); } catch { return { lastRestartAt: null, streaks: {} }; }
}
function writeState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  const tmp = `${STATE_PATH}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  renameSync(tmp, STATE_PATH);
}

/** One SYN, closed on connect. True when something is listening on the Tuya port. */
function tcpOpen(ip, port = 6668, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const s = net.connect({ host: ip, port });
    const done = (v) => { try { s.destroy(); } catch { /* closed */ } resolve(v); };
    s.setTimeout(timeoutMs, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

/** Node name -> registry device id(s). Meters are matched on display name; a name nothing knows is skipped. */
function registryIdsFor(name) {
  const direct = registryIdForNodeName(name);
  if (direct) return [direct];
  const lower = String(name).toLowerCase();
  const byDisplay = DEVICE_REGISTRY.filter((d) => String(d.display_name ?? '').toLowerCase() === lower).map((d) => d.id);
  return byDisplay;
}

const bootedAt = Date.now() - Number(readFileSync('/proc/uptime', 'utf8').split(' ')[0]) * 1000;
const admin = createAdminClient({ host: '127.0.0.1', port: 1880, timeoutMs: 15000 });
let flows;
try {
  const auth = await admin.login();
  ({ flows } = await admin.getFlows(auth));
} catch (err) {
  log(`cannot read the flow (${err?.message ?? err}); nothing decided`);
  process.exit(0);
}
let latest;
try {
  latest = await (await fetch(`${BRIDGE}/api/readings/latest`)).json();
} catch (err) {
  log(`cannot read the bridge (${err?.message ?? err}); nothing decided`);
  process.exit(0);
}
const online = new Map(latest.filter((r) => r.device_id !== '_totals').map((r) => [r.device_id, !!r.online]));
const lanMap = readLanMap();
const now = Date.now();

const observations = [];
for (const node of flows.filter((n) => n?.type === 'tuya-smart-device' && n.disableAutoStart !== true)) {
  const ids = registryIdsFor(node.deviceName);
  if (ids.length === 0 || ids.some((id) => !online.has(id))) continue;
  const offline = ids.every((id) => online.get(id) === false);
  let evidence = null;
  if (offline) {
    if (node.deviceIp) {
      if (await tcpOpen(node.deviceIp)) evidence = `tcp 6668 open at ${node.deviceIp}`;
    } else {
      // An announcement alone is not reachability: on 2026-09-22 the IR hub announced at 07:47 and
      // was EHOSTUNREACH by 07:54, with its node retrying — a device fault, not a stuck node. The
      // announced address must also answer now.
      const entry = lanMap[node.deviceId];
      const seen = entry?.lastSeen ? Date.parse(entry.lastSeen) : NaN;
      if (Number.isFinite(seen) && now - seen <= ANNOUNCED_WITHIN_MS && entry.ip && (await tcpOpen(entry.ip))) {
        evidence = `announced ${Math.round((now - seen) / 60000)} min ago from ${entry.ip}, which accepts tcp 6668 now`;
      }
    }
  }
  observations.push({ name: node.deviceName, offline, evidence });
}

// A pinned node whose device now announces from elsewhere: said loudly, never fixed from here.
for (const d of driftedAddresses(flows.filter((n) => n?.type === 'tuya-smart-device'), lanMap, { now })) {
  log(`ADDRESS DRIFT: "${d.name}" is pinned to ${d.pinned} but announced from ${d.announced} — run set-device-ip:pi --from-lan-map, and reserve it on the AP`);
}

const state = readState();
const decision = decideRecovery({ now, bootedAt, lastRestartAt: state.lastRestartAt ?? null, streaks: state.streaks ?? {}, observations });
const offlineCount = observations.filter((o) => o.offline).length;
log(`${observations.length} node(s) checked, ${offlineCount} offline to the bridge, ${Object.keys(decision.streaks).length} reachable-but-offline`);
for (const r of decision.reasons) log(r);

if (decision.restart && !DRY) {
  log('restarting Node-RED');
  try {
    execFileSync('sudo', ['-n', 'systemctl', 'restart', 'nodered'], { stdio: 'inherit' });
    writeState({ lastRestartAt: now, streaks: {} });
    log('restarted; streaks cleared');
  } catch (err) {
    log(`restart failed: ${err?.message ?? err}`);
    writeState({ lastRestartAt: state.lastRestartAt ?? null, streaks: decision.streaks });
    process.exit(1);
  }
} else {
  if (decision.restart) log('dry run — would restart Node-RED now');
  writeState({ lastRestartAt: state.lastRestartAt ?? null, streaks: decision.streaks });
}
