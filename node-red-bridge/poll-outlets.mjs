#!/usr/bin/env node
/**
 * Gives the outlet nodes a periodic refresh, in the live Node-RED flow.
 *
 *     node node-red-bridge/poll-outlets.mjs --host=<pi>            # dry run
 *     node node-red-bridge/poll-outlets.mjs --host=<pi> --apply    # write it
 *
 * DRY RUN BY DEFAULT. Prints the plan and the invariant check; writes nothing without --apply.
 *
 * Why (ROADMAP FI-013): nothing in the flow asks an outlet for its state, so its reading only
 * advances when the device spontaneously reports a change. Because `readings` is keyed
 * `(device_id, ts)` and ingestion upserts, a stalled timestamp overwrites its own row rather
 * than adding one — an idle outlet contributes far fewer samples than a meter, and every
 * per-outlet figure downstream inherits that.
 *
 * This patch only ADDS nodes. The plan lives in `outletPollPlan.mjs` so a dry run and an apply
 * compute the same thing.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDotEnv, createAdminClient } from './nodeRedAdmin.mjs';
import { planOutletPoll, validateOutletPoll, POLL_INTERVAL_S } from './outletPollPlan.mjs';

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
  console.error('Usage: node node-red-bridge/poll-outlets.mjs --host=<pi> [--apply]');
  process.exit(2);
}

const client = createAdminClient({ host: HOST, port: PORT, timeoutMs: 20000 });
const auth = await client.login();
const { flows, rev } = await client.getFlows(auth);
console.log(`Read ${flows.length} nodes (rev ${rev}).\n`);

const plan = planOutletPoll(flows);
if (plan.unchanged) {
  console.log(`Nothing to do — ${plan.reason}.`);
  process.exit(0);
}

const isUpgrade = (plan.upgraded ?? []).length > 0;

console.log('=== PLAN ===');
if (isUpgrade) {
  console.log('  upgrade the existing poll function: one output per outlet, skipping any the');
  console.log('  parser has flagged disconnected. Adds no nodes and touches nothing else.');
} else {
  console.log(`  add 2 nodes: an inject every ${POLL_INTERVAL_S}s and a function sending { operation: 'GET' }`);
}
console.log(`  polling ${plan.targets.length} outlet(s): ${plan.targets.join(', ')}`);
console.log(`\nResulting flow size: ${flows.length} -> ${plan.flows.length} nodes.\n`);

console.log('=== INVARIANTS ===');
const problems = validateOutletPoll(flows, plan.flows);
if (problems.length) {
  for (const p of problems) console.error(`  FAIL  ${p}`);
  console.error('\nABORT: the plan violates an invariant. Nothing was written.');
  process.exit(1);
}
console.log(isUpgrade ? '  OK  no nodes added; only the poll function changed' : '  OK  exactly 2 nodes added');
console.log('  OK  no other existing node modified or removed');
console.log('  OK  every outlet has its own output and is reached by the poller');
console.log('  OK  every outlet health key is consulted, so a disconnected one is skipped');
console.log('  OK  no dangling wires');

if (!APPLY) {
  console.log('\nDry run — nothing written. Re-run with --apply to deploy.');
  console.log('Back up first: cp ~/.node-red/flows.json ~/.node-red/flows.json.bak-$(date +%F-%H%M%S)');
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
console.log('Applied. Outlet readings should start advancing every minute.');
console.log('Verify: watch an idle outlet\'s LAST SEEN on the Devices page — it should no longer stall.');
