#!/usr/bin/env node
/**
 * Compares Tuya's cloud view of every device against the bridge's local view.
 *
 *     node server/tuya-devices.mjs [--bridge=<host>] [--keys]
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

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDotEnv } from '../node-red-bridge/nodeRedAdmin.mjs';
import { createTuyaClient, TUYA_HOSTS } from './tuyaCloud.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
loadDotEnv(join(HERE, '..'));
loadDotEnv(HERE);

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const WANT_KEYS = process.argv.includes('--keys');
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
const host = TUYA_HOSTS[REGION];
if (!host) {
  console.error(`Unknown TUYA_REGION "${REGION}". Expected one of: ${Object.keys(TUYA_HOSTS).join(', ')}`);
  process.exit(2);
}

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

// The comparison is only meaningful for devices this bridge actually knows about, and the
// cloud names them differently from the registry — so it is reported in aggregate rather than
// guessing a per-device mapping that nothing in the repo records yet.
if (local) {
  const localOffline = [...local.entries()].filter(([, on]) => on === false).length;
  const cloudOffline = cloud.filter((d) => !d.online).length;
  console.log(`\nlocal view : ${local.size - localOffline}/${local.size} online`);
  console.log(`cloud view : ${cloud.length - cloudOffline}/${cloud.length} online`);
  if (cloudOffline < localOffline) {
    console.log(
      `\nThe cloud sees MORE devices up than the bridge does. Those devices are powered, joined,\n` +
        `and talking to Tuya — the Pi simply cannot reach them. That points at the access point\n` +
        `(client isolation, a client limit, or addressing), not at the devices. See ROADMAP RM-013.`,
    );
  } else if (cloudOffline >= localOffline && cloudOffline > 0) {
    console.log(
      `\nThe cloud agrees the devices are down, so this is not the network getting in the way.\n` +
        `Look at the devices themselves: power, range, pairing.`,
    );
  }
}
