#!/usr/bin/env node
/**
 * Installs exponential back-off on failed device discovery.
 *
 *     node node-red-bridge/apply-discovery-backoff.mjs --host=<pi>            # dry run
 *     node node-red-bridge/apply-discovery-backoff.mjs --host=<pi> --apply    # write it
 *
 * DRY RUN BY DEFAULT. Prints the plan and the invariant check; writes nothing without --apply.
 *
 * WHY. `docs/adr-002-device-recovery-path.md` prescribed backing off on failed discovery rather
 * than retrying at a fixed rate forever, and nothing ever built it. Measured 2026-09-03, with
 * fourteen devices off the air after the RM-020 power cycle: ~230 journal lines a minute, 12,386
 * in 3.6 h, load average near 3.5 — from retrying a `find()` that cannot succeed, because
 * `find()` only locates a device that broadcasts and a 30 s listen heard three of twenty.
 *
 * WHAT IT DOES NOT DO, and this is the point: it does not edit `retryTimeout` on any tuya node.
 * That value, with `findTimeout` and `tuyaVersion`, lives only on the hand-built source tabs and
 * is declared nowhere in this repository — losing it produces no diff, no alarm, and every device
 * reading offline. The back-off is applied at run time through the vendor node's own
 * `CONTROL` / `SET_RETRY_TIMEOUT` operation, so nothing on disk changes, `findSettingsDrift`
 * stays valid, and a Node-RED restart returns every node to its declared 1 s.
 *
 * BACK UP `~/.node-red/flows.json` BEFORE APPLYING. This adds nodes to the hand-built source
 * tabs. It modifies none of them — the invariant check refuses to write if it would.
 *
 * AFTER APPLYING: no restart needed. Watch the journal rate rather than trusting the 2xx —
 *   sudo journalctl -u nodered --since "-5 min" | wc -l
 * should fall over the following few minutes as each absent device climbs its own schedule. A
 * device that comes back is reset to 1 s the moment it reports connected.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDotEnv, createAdminClient } from './nodeRedAdmin.mjs';
import {
  planDiscoveryBackoff, validateDiscoveryBackoff, tuyaNodesOn,
  BASE_RETRY_MS, MAX_RETRY_MS,
} from './discoveryBackoffPlan.mjs';

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
  console.error('Usage: node node-red-bridge/apply-discovery-backoff.mjs --host=<pi> [--apply]');
  process.exit(2);
}

const client = createAdminClient({ host: HOST, port: PORT, timeoutMs: 20000 });
const auth = await client.login();
const { flows, rev } = await client.getFlows(auth);
console.log(`Read ${flows.length} nodes (rev ${rev}).\n`);

const plan = planDiscoveryBackoff(flows);

if (plan.unchanged) {
  console.log(`Nothing to do: ${plan.reason}`);
  process.exit(0);
}

const tabLabel = (z) => flows.find((n) => n.id === z && n.type === 'tab')?.label ?? z;
const touched = [...new Set([...plan.added, ...[]].map((n) => n.z))];
const tabs = touched.length ? touched : [...new Set(plan.targets.map((id) => flows.find((n) => n.id === id)?.z))];

console.log(`Back-off controller for ${plan.targets.length} device node(s), ${BASE_RETRY_MS} ms -> ${MAX_RETRY_MS} ms:`);
for (const z of tabs) {
  const names = tuyaNodesOn(flows, z).map((n) => n.deviceName ?? n.id);
  console.log(`  ${tabLabel(z)}: ${names.join(', ')}`);
}
if (plan.added.length) console.log(`\nAdds ${plan.added.length} node(s): one status watcher and one controller per tab.`);
if (plan.upgraded.length) console.log(`\nUpgrades ${plan.upgraded.length} existing controller node(s) to the current device set.`);
console.log('\nNo tuya node is modified — the back-off is a run-time control message, so');
console.log('retryTimeout, findTimeout and tuyaVersion on the source tabs are left exactly as they are.');

const problems = validateDiscoveryBackoff(flows, plan.flows);
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
console.log('\nDeployed. Watch the journal rate rather than trusting this 2xx:');
console.log('  sudo journalctl -u nodered --since "-5 min" | wc -l');
console.log('It should fall over the next few minutes as each absent device climbs its schedule.');
console.log('A device that returns is reset to the declared retry the moment it reports connected.');
