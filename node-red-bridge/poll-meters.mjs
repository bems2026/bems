#!/usr/bin/env node
/**
 * Gives the CT meter sessions a periodic GET, in the live Node-RED flow — RM-134.
 *
 *     node node-red-bridge/poll-meters.mjs --host=<pi>            # dry run
 *     node node-red-bridge/poll-meters.mjs --host=<pi> --apply    # write it
 *
 * DRY RUN BY DEFAULT. Prints the plan and the invariant check; writes nothing without --apply.
 *
 * Why: the tuya node never reads a device's state on connect, and nothing polled the meters, so a
 * meter was push-only — a change pushed while the bridge was down was never seen, and a channel then
 * at 0 W had nothing new to push. L.O Yellow held 39.8 W for hours on 2026-09-22 that way. The plan
 * lives in `meterPollPlan.mjs` so a dry run and an apply compute the same thing. The write uses
 * `Node-RED-Deployment-Type: nodes`, so only the two new nodes start: no session reconnects.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDotEnv, createAdminClient } from './nodeRedAdmin.mjs';
import { planMeterPoll, validateMeterPoll, POLL_INTERVAL_S } from './meterPollPlan.mjs';
import { DEVICE_REGISTRY } from '../shared/registry.mjs';

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
  console.error('Usage: node node-red-bridge/poll-meters.mjs --host=<pi> [--apply]');
  process.exit(2);
}

const client = createAdminClient({ host: HOST, port: PORT, timeoutMs: 20000 });
const auth = await client.login();
const { flows, rev } = await client.getFlows(auth);
console.log(`Read ${flows.length} nodes (rev ${rev}).\n`);

const plan = planMeterPoll(flows, { registry: DEVICE_REGISTRY });
if (plan.unchanged) {
  // A refusal is not "nothing to do": say which, and exit non-zero for the one that needs a person.
  const refused = /cannot locate|more than one tab|repair by hand|no meter sessions/.test(plan.reason);
  console.log(`${refused ? 'REFUSED' : 'Nothing to do'} — ${plan.reason}.`);
  process.exit(refused ? 1 : 0);
}

const isUpgrade = plan.upgraded.length > 0;
console.log('=== PLAN ===');
if (isUpgrade) console.log('  upgrade the existing meter poll function to the current sessions. Adds no nodes.');
else console.log(`  add 2 nodes: an inject every ${POLL_INTERVAL_S}s and a function sending { operation: 'GET' }`);
console.log(`  polling ${plan.targets.length} meter session(s): ${plan.targets.join(', ')}`);
console.log(`\nResulting flow size: ${flows.length} -> ${plan.flows.length} nodes.\n`);

console.log('=== INVARIANTS ===');
const problems = validateMeterPoll(flows, plan.flows, { registry: DEVICE_REGISTRY });
if (problems.length) {
  for (const p of problems) console.error(`  FAIL  ${p}`);
  console.error('\nABORT: the plan violates an invariant. Nothing was written.');
  process.exit(1);
}
console.log(isUpgrade ? '  OK  no nodes added; only the poll function changed' : '  OK  exactly 2 nodes added');
console.log('  OK  no other existing node modified or removed');
console.log('  OK  every meter session has its own output and is reached by the poller');
console.log('  OK  every session health key is consulted, so a disconnected one is skipped');
console.log('  OK  no dangling wires');

if (!APPLY) {
  console.log('\nDry run — nothing written. Re-run with --apply to deploy.');
  console.log("Back up first: cp ~/.node-red/flows.json ~/.node-red/flows.json.bak-$(date +%F-%H%M%S)");
  process.exit(0);
}

console.log('\nApplying…');
const res = await client.postFlows(auth, plan.flows, rev);
if (res.status === 409) {
  console.error('ABORT: HTTP 409 — the flow changed between the read and this write. Re-run.');
  process.exit(1);
}
if (!res.ok) {
  console.error(`ABORT: POST /flows failed — HTTP ${res.status}`);
  console.error(await res.text().catch(() => ''));
  process.exit(1);
}
console.log('Applied. The first GET goes out 10 s after the deploy, then every minute.');
console.log('Verify: the demux raw record gains dp 103/113, and every meter reading moves or reads 0 W.');
