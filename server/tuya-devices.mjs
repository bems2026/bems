#!/usr/bin/env node
/**
 * Compares Tuya's cloud view of every device against the bridge's local view, and optionally
 * audits the flow's local keys against the cloud's.
 *
 *     node server/tuya-devices.mjs [--bridge=<host>] [--keys] [--verify-keys]
 *
 * WHY: when a device is unreachable on the LAN, nothing else here can tell "the device is off"
 * from "the device is fine and the network is in the way". The cloud reaches devices over the
 * internet, not the local subnet, so the two views disagreeing IS the diagnosis:
 *
 *     cloud ONLINE  + local offline -> the device is up and talking to Tuya. The Pi cannot
 *                                      reach it: AP client isolation, a client limit, or an
 *                                      addressing problem. Look at the access point.
 *     cloud OFFLINE + local offline -> the device is genuinely off the network. Look at the
 *                                      device: power, range, pairing.
 *     cloud OFFLINE + local online  -> the device is on the LAN but has lost its uplink to
 *                                      Tuya. Harmless here; local control is what this system
 *                                      uses.
 *
 * READ-ONLY. Makes no writes to the cloud, the flow, or the database.
 *
 * SECRETS: local keys are fetched only with `--keys`, and even then only their length is
 * printed. The values exist to be written into a registry by a future enrolment step, never to
 * be read off a terminal — this repository is public and terminals get pasted into issues.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDotEnv } from '../node-red-bridge/nodeRedAdmin.mjs';
import { createTuyaClient, TUYA_HOSTS, probeTuyaHost } from './tuyaCloud.mjs';
import { auditKeys, auditIsClean, KEY_STATUS } from './keyAudit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
loadDotEnv(join(HERE, '..'));
loadDotEnv(HERE);

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const WANT_KEYS = process.argv.includes('--keys');
const VERIFY_KEYS = process.argv.includes('--verify-keys');
const BRIDGE = arg('bridge', '127.0.0.1');
const REGION = (process.env.TUYA_REGION ?? 'us').toLowerCase();

const accessId = process.env.TUYA_ACCESS_ID;
const accessSecret = process.env.TUYA_ACCESS_SECRET;

if (!accessId || !accessSecret) {
  console.error('Missing TUYA_ACCESS_ID / TUYA_ACCESS_SECRET.');
  console.error('Add them to server/.env on the Pi (gitignored). Never to this repository.');
  console.error('Optionally set TUYA_REGION to one of: ' + Object.keys(TUYA_HOSTS).join(', '));
  process.exit(2);
}
let host = TUYA_HOSTS[REGION];
if (!host) {
  // The region shown in the Tuya console does not map cleanly onto a host — newer data centres
  // live on a different domain and the older ones were never renamed — so an unrecognised name
  // is probed rather than rejected. Guessing would surface as `sign invalid`, which is
  // indistinguishable from a wrong secret.
  console.log(`TUYA_REGION="${process.env.TUYA_REGION}" is not a known code. Probing every data centre...`);
  const found = await probeTuyaHost({ accessId, accessSecret });
  if (!found.host) {
    console.error('\nNo data centre accepted these credentials. Every host was tried:');
    for (const a of found.attempts) console.error(`  ${a.region.padEnd(8)} ${a.error}`);
    console.error('\nAll hosts failing points at the credentials, not the region.');
    process.exit(1);
  }
  host = found.host;
  console.log(`Authenticated against "${found.region}" (${found.host}).`);
  console.log(`Set TUYA_REGION=${found.region} in server/.env to skip this probe next time.\n`);
}

/**
 * The bridge's own view, for comparison. A failure here is reported and tolerated: the cloud
 * listing is still worth printing on its own, and refusing to show it because the local side
 * was unreachable would withhold the more useful half.
 */
async function localView() {
  try {
    const res = await fetch(`http://${BRIDGE}:1880/api/readings/latest`, { signal: AbortSignal.timeout(10_000) });
    const rows = await res.json();
    return new Map(rows.map((r) => [r.device_id, r.online]));
  } catch (e) {
    console.error(`Could not read the bridge at ${BRIDGE}:1880 — ${e.message}`);
    return null;
  }
}

const client = createTuyaClient({ accessId, accessSecret, host });

const [cloud, local] = await Promise.all([client.listDevices(), localView()]);
if (!cloud.length) {
  console.log('The cloud project reports no devices. Check that the Smart Life account is linked to it.');
  process.exit(0);
}

console.log(`Tuya cloud project: ${cloud.length} devices (region ${REGION})\n`);
console.log('cloud-name'.padEnd(24), 'cloud'.padEnd(8), 'id'.padEnd(12), 'key');

for (const d of cloud.sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
  let keyNote = WANT_KEYS ? '(not fetched)' : '(use --keys)';
  if (WANT_KEYS) {
    try {
      const detail = await client.describeDevice(d.id);
      // Length only. The value is for a registry, not for a screen.
      keyNote = detail?.local_key ? `present, ${detail.local_key.length} chars` : 'ABSENT';
    } catch (e) {
      keyNote = `unavailable (${e.message.slice(0, 30)})`;
    }
  }
  console.log(
    String(d.name).slice(0, 23).padEnd(24),
    (d.online ? 'ONLINE' : 'offline').padEnd(8),
    String(d.id).slice(0, 8).padEnd(12),
    keyNote,
  );
}

/**
 * Per-device comparison, joined on the Tuya device id that both sides already carry: the flow's
 * tuya nodes hold it, and the cloud listing returns it.
 *
 * An earlier version compared offline COUNTS instead — 21 local entries against 17 cloud
 * devices — and drew a conclusion from the difference. Those denominators are not comparable:
 * several registry devices are two logical readers of one physical meter, and two flow nodes
 * have no cloud device at all. Counting across mismatched populations produced a confident
 * verdict with nothing behind it.
 */
const flowPath = '/home/bems/.node-red/flows.json';
let nodes = [];
try {
  nodes = JSON.parse(fs.readFileSync(flowPath, 'utf8')).filter((n) => n.type === 'tuya-smart-device');
} catch {
  console.log('\n(Per-device comparison needs the live flow; not readable from here.)');
}

if (nodes.length && local) {
  const cloudById = new Map(cloud.map((d) => [d.id, d]));
  const rows = [];
  for (const n of nodes) {
    const c = cloudById.get(n.deviceId);
    rows.push({ node: n.deviceName, cloud: c ? (c.online ? 'ONLINE' : 'offline') : 'NOT IN PROJECT' });
  }
  console.log('\nnode                cloud');
  for (const r of rows.sort((a, b) => a.node.localeCompare(b.node))) {
    console.log(`  ${r.node.padEnd(18)} ${r.cloud}`);
  }

  const orphans = rows.filter((r) => r.cloud === 'NOT IN PROJECT');
  const cloudDown = rows.filter((r) => r.cloud === 'offline');
  console.log('');
  if (orphans.length) {
    console.log(`${orphans.length} flow node(s) reference a device this cloud project does not contain:`);
    console.log(`  ${orphans.map((r) => r.node).join(', ')}`);
    console.log('  They cannot work. Either they belong to another account, or they were removed.');
  }
  if (cloudDown.length) {
    console.log(`${cloudDown.length} device(s) are offline to TUYA as well as to the bridge:`);
    console.log(`  ${cloudDown.map((r) => r.node).join(', ')}`);
    console.log('  Tuya reaches these over the internet, not the local subnet — so these are genuinely');
    console.log('  off the network. That is the device or the access point dropping them, not the Pi');
    console.log('  failing to see them.');
  }
  console.log('\nRe-run this a few minutes apart: a device whose cloud state changes between runs is');
  console.log('flapping at the network level, which is RM-013 and is not fixable from this side.');
}

/**
 * Key audit. A wrong local key does not fail loudly — the device is discovered, the connection
 * is attempted, and it fails in a way that reads as a network problem. Re-pairing rotates the
 * key, and this project has already once blamed a stale key for the wrong devices because
 * nothing could check.
 *
 * Neither key is printed, and neither reaches the result object — see server/keyAudit.mjs.
 */
if (VERIFY_KEYS && nodes.length) {
  console.log('\nVerifying local keys against the cloud (values are compared, never shown)...');
  const cloudIds = new Set(cloud.map((d) => d.id));
  const results = await auditKeys(nodes, async (deviceId) => {
    if (!cloudIds.has(deviceId)) return undefined;
    const detail = await client.describeDevice(deviceId);
    return detail?.local_key ?? null;
  });
  console.log('');
  for (const r of results.sort((a, b) => a.name.localeCompare(b.name))) {
    const flag = r.status === KEY_STATUS.MISMATCH ? '  <-- REPAIR THIS' : '';
    console.log(`  ${r.name.padEnd(18)} ${r.status}${r.detail ? ' (' + r.detail + ')' : ''}${flag}`);
  }
  const mismatched = results.filter((r) => r.status === KEY_STATUS.MISMATCH);
  if (mismatched.length) {
    console.log(`\n${mismatched.length} node(s) hold a key the cloud disagrees with. Those devices cannot`);
    console.log('connect, and the symptom looks like a network fault. Update the flow with the current key.');
  } else if (auditIsClean(results)) {
    console.log('\nEvery key the cloud can vouch for matches the flow.');
  }
}