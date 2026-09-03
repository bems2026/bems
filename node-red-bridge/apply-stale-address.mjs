#!/usr/bin/env node
/**
 * Installs recovery from a cached device address that has stopped existing — FI-025.
 *
 *     node node-red-bridge/apply-stale-address.mjs --host=<pi>            # dry run
 *     node node-red-bridge/apply-stale-address.mjs --host=<pi> --apply    # write it
 *
 * DRY RUN BY DEFAULT. Prints the plan and the invariant check; writes nothing without --apply.
 *
 * WHY. `tuyapi` caches a device's resolved address on the instance and short-circuits `find()`
 * once it is set (`index.js:996-1002`), so a node whose device has moved retries a dead address
 * forever without ever broadcasting again. Measured after the AP renumbered its LAN: 325 and 323
 * `EHOSTUNREACH` in 3.6 h against two leases that had been valid that morning. `find()` is the
 * only thing that can discover the new address, and a node in this state never really calls it.
 *
 * The remedy is `CONTROL`/`DISCONNECT` then `CONTROL`/`CONNECT`, because CONNECT runs the vendor
 * node's `initTuya()` — a NEW `TuyaDevice`, with no cached address. `RECONNECT` does not do this:
 * it reuses the instance. Nothing on disk changes and no tuya node is modified; the invariant
 * check refuses to write if it would.
 *
 * SELF-LIMITING: after a recovery the node really does broadcast, so a device that is genuinely
 * absent produces a find TIMEOUT next, which resets the streak. Absent devices get one attempt,
 * not a loop. A 60 s per-device cooldown is the second guard on the same thing.
 *
 * BACK UP `~/.node-red/flows.json` BEFORE APPLYING. This adds nodes to the hand-built source
 * tabs, which carry `findTimeout` and `tuyaVersion` — values nothing in this repository declares.
 *
 * AFTER APPLYING: watch for the EHOSTUNREACH count falling, and for a `find` actually running.
 *   sudo journalctl -u nodered --since "-10 min" | grep -c EHOSTUNREACH
 * A 2xx from the admin API means the flow was accepted, not that a device was recovered.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDotEnv, createAdminClient } from './nodeRedAdmin.mjs';
import {
  planStaleAddress, validateStaleAddress, tuyaNodesOn,
  UNREACHABLE_MARKERS, UNREACHABLE_STREAK, RECOVERY_COOLDOWN_MS,
} from './staleAddressPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
loadDotEnv(join(HERE, '..'));

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const HOST = arg('host');
const PORT = Number(arg('port', '1880'));
const APPLY = process.argv.includes('--apply');

if (!HOST) {
  console.error('Usage: node node-red-bridge/apply-stale-address.mjs --host=<pi> [--apply]');
  process.exit(2);
}

const client = createAdminClient({ host: HOST, port: PORT, timeoutMs: 20000 });
const auth = await client.login();
const { flows, rev } = await client.getFlows(auth);
console.log(`Read ${flows.length} nodes (rev ${rev}).\n`);

const plan = planStaleAddress(flows);

if (plan.unchanged) {
  console.log(`Nothing to do: ${plan.reason}`);
  process.exit(0);
}

const tabLabel = (z) => flows.find((n) => n.id === z && n.type === 'tab')?.label ?? z;
const tabs = [...new Set(plan.targets.map((id) => flows.find((n) => n.id === id)?.z))];

console.log(`Stale-address recovery for ${plan.targets.length} device node(s).`);
console.log(`Trigger: ${UNREACHABLE_STREAK} consecutive [${UNREACHABLE_MARKERS.join(', ')}] errors,`);
console.log(`then DISCONNECT + CONNECT, at most once per ${RECOVERY_COOLDOWN_MS / 1000}s per device.\n`);
for (const z of tabs) {
  console.log(`  ${tabLabel(z)}: ${tuyaNodesOn(flows, z).map((n) => n.deviceName ?? n.id).join(', ')}`);
}
if (plan.added.length) console.log(`\nAdds ${plan.added.length} node(s): one catch node and one controller per tab.`);
if (plan.upgraded.length) console.log(`\nUpgrades ${plan.upgraded.length} existing node(s) to the current device set.`);
console.log('\nNo tuya node is modified — the recovery is a run-time control message, so deviceIp,');
console.log('retryTimeout, findTimeout and tuyaVersion on the source tabs are left exactly as they are.');

const problems = validateStaleAddress(flows, plan.flows);
if (problems.length) {
  console.error('\nINVARIANT CHECK FAILED — refusing to write:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('\nInvariants hold: nothing existing is modified, removed, or left wired to nothing.');

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write it — and back up ~/.node-red/flows.json first.');
  process.exit(0);
}

const res = await client.postFlows(auth, plan.flows, rev);
if (res.status === 409) {
  console.error('\nABORT: HTTP 409 — the flow changed between the read and this write. Re-run.');
  process.exit(1);
}
if (!res.ok) {
  console.error(`\nDeploy failed: HTTP ${res.status}`);
  console.error(await res.text().catch(() => ''));
  process.exit(1);
}
console.log('\nDeployed. Verify by measurement, not by this 2xx:');
console.log('  sudo journalctl -u nodered --since "-10 min" | grep -c EHOSTUNREACH');
console.log('A node that was stuck should stop naming a dead address and start timing out on');
console.log('find() instead — which is the broadcast path, and the only one that can recover it.');
