#!/usr/bin/env node
/**
 * Gives a `tuya-smart-device` node a static address, so the bridge stops depending on a
 * discovery broadcast the device has stopped sending.
 *
 *     node node-red-bridge/set-device-ip.mjs --host=<pi>                   # dry run
 *     node node-red-bridge/set-device-ip.mjs --host=<pi> --apply
 *     node node-red-bridge/set-device-ip.mjs --host=<pi> --name=CO5 --apply
 *     node node-red-bridge/set-device-ip.mjs --host=<pi> --undo --apply
 *     node node-red-bridge/set-device-ip.mjs --host=<pi> --from-lan-map [--max-age-days=30] [--apply]
 *     node node-red-bridge/set-device-ip.mjs --host=<pi> --reservations      # the table for the AP
 *
 * DRY RUN BY DEFAULT, like every other script that writes to the live flow.
 *
 * `--from-lan-map` (RM-131) resolves every node from `server/data/lan-map.json` — what
 * `ibems-lan-map.timer` has heard the devices announce, with no cloud in the path. After the
 * 2026-09-21 outage test the fleet sat associated, ARP-reachable and accepting TCP on 6668 while
 * sending no discovery broadcast, and the cloud that used to map them had lapsed (RM-121). The map
 * fills whenever a device announces (a power cycle makes every one of them announce), and
 * `--reservations` prints the MAC/address table to type into the access point so the addresses
 * stay true across the next outage.
 *
 * WHY: the bridge finds a device only by its UDP discovery broadcast, so one that has stopped
 * broadcasting reports `online: false` — indistinguishable, from the bridge's side, from one
 * that is unplugged. When ARP proves the device is still associated to the access point, the
 * broadcast is the only thing missing, and tuyapi's `find()` short-circuits when id and ip are
 * both set. That turns a drive to the office into a config change (RM-021).
 *
 * THE ADDRESS IS NEVER TYPED IN AND NEVER COMMITTED. With no `--ip=`, each target is resolved
 * at run time: the vendor cloud's MAC for that device, joined against this host's ARP table.
 * That keeps the site's addressing out of a public repository, and it is also simply correct —
 * a written-down address is wrong the moment DHCP moves it. **A DHCP reservation on the access
 * point is the durable version of this, and it is an operator action.**
 *
 * RUNS ONLY ON THE PI: it reads this host's neighbour table, so it is meaningless anywhere else.
 *
 * REVERSIBLE. `--undo` clears the field, which is what you want the moment the device starts
 * broadcasting again — though leaving it set is harmless, and holds the device through the next
 * dormant window rather than losing it for hours.
 *
 * THIS WRITES TO THE HAND-BUILT SOURCE TABS. `build-flow.mjs` does not generate them and nothing
 * in the repo can restore them, so **back up `~/.node-red/flows.json` first**. The plan is
 * checked by `validateDeviceIpPlan` to change exactly one string on exactly the named nodes —
 * `findTimeout` and `tuyaVersion` live only here.
 */

import { loadDotEnv, createAdminClient } from './nodeRedAdmin.mjs';
import { planDeviceIp, validateDeviceIpPlan } from './deviceIpPlan.mjs';
import { createTuyaClient, TUYA_HOSTS } from '../server/tuyaCloud.mjs';
import { joinMacPresence, readNeighbours, PRESENCE } from '../server/macPresence.mjs';
import { assignmentsFromMap, readLanMap, reservationRows } from '../server/lanMap.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
loadDotEnv(join(HERE, '..'));
loadDotEnv(join(HERE, '..', 'server'));

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const HOST = arg('host', '127.0.0.1');
const PORT = Number(arg('port', '1880'));
const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
const EXPLICIT_IP = arg('ip', null);
const FROM_LAN_MAP = process.argv.includes('--from-lan-map');
const RESERVATIONS = process.argv.includes('--reservations');
const MAX_AGE_DAYS = Number(arg('max-age-days', '30'));
const NAMES = process.argv.filter((a) => a.startsWith('--name=')).map((a) => a.slice(7));

console.log(`${APPLY ? 'Applying' : 'Dry run (pass --apply to actually write)'} to http://${HOST}:${PORT}`);

const admin = createAdminClient({ host: HOST, port: PORT, timeoutMs: 20000 });
const auth = await admin.login();
const { flows, rev } = await admin.getFlows(auth);
console.log(`Read ${flows.length} existing nodes.\n`);

/**
 * Which devices to address. With no `--name=`, the default is exactly the devices the presence
 * join says are in RM-021's condition: dark to the vendor cloud, yet still answering ARP. That
 * is deliberately computed rather than hard-coded — the membership moved twice inside one hour
 * on 2026-08-26, and a list written into a script would be wrong by the time it ran.
 */
async function resolveTargets() {
  if (FROM_LAN_MAP) {
    const map = readLanMap();
    if (Object.keys(map).length === 0) {
      console.error('server/data/lan-map.json is empty — nothing has announced itself while the listener ran.');
      console.error('Start ibems-lan-map.timer (or run node server/lan-map-learn.mjs), power-cycle the devices, and try again.');
      process.exit(1);
    }
    const { assignments, notes } = assignmentsFromMap(flows, map, { maxAgeMs: MAX_AGE_DAYS * 86400000 });
    const chosen = NAMES.length ? Object.fromEntries(Object.entries(assignments).filter(([n]) => NAMES.includes(n))) : assignments;
    return { assignments: chosen, notes };
  }
  if (UNDO) {
    const names = NAMES.length
      ? NAMES
      : flows.filter((n) => n.type === 'tuya-smart-device' && n.deviceIp).map((n) => n.deviceName);
    return { assignments: Object.fromEntries(names.map((n) => [n, null])), notes: [] };
  }
  if (EXPLICIT_IP) {
    if (!NAMES.length) {
      console.error('--ip= needs an explicit --name=; it must never be applied to a computed set.');
      process.exit(1);
    }
    return { assignments: Object.fromEntries(NAMES.map((n) => [n, EXPLICIT_IP])), notes: [] };
  }

  const accessId = process.env.TUYA_ACCESS_ID;
  const accessSecret = process.env.TUYA_ACCESS_SECRET;
  const cloudHost = TUYA_HOSTS[(process.env.TUYA_REGION ?? 'us').toLowerCase()];
  if (!accessId || !accessSecret || !cloudHost) {
    console.error('Resolving an address needs TUYA_ACCESS_ID / TUYA_ACCESS_SECRET / TUYA_REGION in server/.env.');
    console.error('Alternatively pass --name= and --ip= explicitly.');
    process.exit(1);
  }

  const { readable, neighbours, reason } = readNeighbours();
  if (!readable) {
    // Refuse rather than proceed: with no ARP view every device looks absent, so this script
    // would decline to address the very devices it exists for and report success doing it.
    console.error(`Cannot read this host's ARP table (${reason}).`);
    console.error('This script resolves addresses from the neighbour table, so it only works on the Pi.');
    process.exit(1);
  }

  const client = createTuyaClient({ accessId, accessSecret, host: cloudHost });
  const cloudDevices = await client.listDevices();
  const factoryInfos = await client.listFactoryInfos(cloudDevices.map((d) => d.id));
  const rows = joinMacPresence({ cloudDevices, factoryInfos, neighbours });

  const candidates = rows.filter(
    (r) => r.presence === PRESENCE.ON_SEGMENT && r.ip && (NAMES.length ? NAMES.includes(r.name) : !r.cloudOnline),
  );
  const notes = NAMES.filter((n) => !candidates.some((c) => c.name === n)).map(
    (n) => `"${n}" is not resolvable from ARP right now — it is not on this segment.`,
  );
  return { assignments: Object.fromEntries(candidates.map((c) => [c.name, c.ip])), notes };
}

if (RESERVATIONS) {
  const rows = reservationRows(flows, readLanMap());
  if (!rows.length) { console.log('No device is in the LAN map yet.'); process.exit(0); }
  const mac = (m) => (m ? m.replace(/[^0-9a-f]/gi, '').replace(/(..)(?=.)/g, '$1:') : '(MAC not seen — read it off the AP)');
  console.log('DHCP reservations for the access point — one per device, so an outage never renumbers them:\n');
  console.log(`  ${'Device'.padEnd(20)} ${'MAC'.padEnd(18)} ${'Address'.padEnd(15)} Last announced`);
  for (const r of rows) console.log(`  ${r.name.padEnd(20)} ${mac(r.mac).padEnd(18)} ${r.ip.padEnd(15)} ${String(r.lastSeen ?? '').slice(0, 16).replace('T', ' ')}`);
  console.log(`\nAnd the Pi itself: ${readNeighbours().readable ? 'its wlan0 MAC (ip link show wlan0)' : 'its wlan0 MAC'} at its current address.`);
  process.exit(0);
}

const { assignments, notes } = await resolveTargets();
for (const n of notes) console.log(`  note: ${n}`);

if (Object.keys(assignments).length === 0) {
  console.log(
    UNDO
      ? 'Nothing to undo — no node carries a static address.'
      : 'No device is currently dark-but-on-segment. Nothing to address.',
  );
  process.exit(0);
}

const plan = planDeviceIp(flows, assignments);
if (plan.problems.length) {
  console.error('Refused:');
  for (const p of plan.problems) console.error(`  - ${p}`);
  process.exit(1);
}

const invalid = validateDeviceIpPlan(flows, plan.flows, assignments);
if (invalid.length) {
  console.error('Refused by the invariants:');
  for (const p of invalid) console.error(`  - ${p}`);
  process.exit(1);
}

if (plan.changed.length === 0) {
  console.log(`Nothing to do — already ${UNDO ? 'cleared' : 'set'}.`);
  process.exit(0);
}

// Names only. The addresses are the point of the change, but printing them puts the site's
// addressing into whatever terminal log this ends up pasted into.
for (const n of plan.changed) console.log(`  ${UNDO ? 'clear' : 'set  '}  ${n.deviceName}`);
console.log(`\nNode count: ${flows.length} -> ${plan.flows.length} (must be unchanged).`);

if (!APPLY) {
  console.log('\nDry run only — nothing was written. Re-run with --apply.');
  console.log('Back up ~/.node-red/flows.json first: findTimeout and tuyaVersion live only on the live flow.');
  process.exit(0);
}

const res = await admin.postFlows(auth, plan.flows, rev);
if (!res.ok) {
  console.error(`\nNode-RED refused the write (HTTP ${res.status}). Nothing changed.`);
  process.exit(1);
}
console.log(
  `\nWritten. Those nodes will ${UNDO ? 'return to discovery' : 'connect directly, skipping discovery'} on the next deploy cycle.`,
);
console.log('Confirm with: sudo journalctl -u nodered --since "-2 min" | grep -E "Connected to device|timed out"');
