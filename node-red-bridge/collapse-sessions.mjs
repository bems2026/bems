#!/usr/bin/env node
/**
 * Collapses duplicate local sessions to a shared physical device, in the live Node-RED flow.
 *
 *     node node-red-bridge/collapse-sessions.mjs --host=<pi>            # dry run
 *     node node-red-bridge/collapse-sessions.mjs --host=<pi> --apply    # write it
 *
 * DRY RUN BY DEFAULT. Prints the plan and the invariant check; writes nothing without --apply.
 *
 * Why this exists: two `tuya-smart-device` nodes carrying the same `deviceId` each hold a TCP
 * session to one physical device. An ESP device has a small connection table, and exhausting it
 * is what leaves a device answering the cloud but not the LAN — the "hang" whose only recovery
 * was removing power (docs/adr-002-device-recovery-path.md). Collapsing also makes the yellow
 * channel interchange impossible by construction (ROADMAP RM-017), since both parsers then read
 * one message instead of racing two sessions.
 *
 * The plan lives in `sessionCollapsePlan.mjs` so a dry run and an apply compute the same thing.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDotEnv, createAdminClient } from './nodeRedAdmin.mjs';
import { planSessionCollapse, validateCollapse } from './sessionCollapsePlan.mjs';

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
  console.error('Usage: node node-red-bridge/collapse-sessions.mjs --host=<pi> [--apply]');
  process.exit(2);
}

const client = createAdminClient({ host: HOST, port: PORT, timeoutMs: 20000 });
const auth = await client.login();
const { flows, rev } = await client.getFlows(auth);
console.log(`Read ${flows.length} nodes (rev ${rev}).\n`);

const plan = planSessionCollapse(flows);
if (plan.unchanged) {
  console.log('No device carries more than one session. Nothing to do.');
  process.exit(0);
}

const tabs = Object.fromEntries(flows.filter((n) => n.type === 'tab').map((t) => [t.id, t.label]));
console.log('=== PLAN ===');
for (const c of plan.collapse) {
  const keeper = flows.find((n) => n.deviceName === c.keep);
  console.log(`  device ${c.deviceId.slice(0, 8)}…  on ${JSON.stringify(tabs[keeper?.z] ?? '?')}`);
  console.log(`    keep    ${c.keep}  -> now feeds ${c.feeds} parser(s)`);
  console.log(`    retire  ${c.retire.join(', ')}`);
}
console.log(`\nResulting flow size: ${flows.length} -> ${plan.flows.length} nodes.\n`);

console.log('=== INVARIANTS ===');
const problems = validateCollapse(flows, plan.flows);
if (problems.length) {
  for (const p of problems) console.error(`  FAIL  ${p}`);
  console.error('\nABORT: the plan violates an invariant. Nothing was written.');
  process.exit(1);
}
console.log('  OK  every device keeps exactly one session');
console.log('  OK  no parser loses its input');
console.log('  OK  no wire points at a removed node');
console.log('  OK  no HTTP endpoint removed');
console.log('  OK  no tab removed');

if (!APPLY) {
  console.log('\nDry run — nothing written. Re-run with --apply to deploy.');
  console.log('Back up the live flow first: cp ~/.node-red/flows.json ~/.node-red/flows.json.bak-$(date +%F-%H%M%S)');
  process.exit(0);
}

console.log('\nApplying…');
// `rev` is passed through so Node-RED rejects the write if the flow changed since the read —
// the same optimistic-concurrency guard deploy.mjs relies on. A 409 means someone edited in the
// editor meanwhile, and silently overwriting them would be worse than failing.
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
console.log('Applied. Devices will reconnect over the next minute or two.');
console.log('Verify with: npm run check:meters   (the yellow interchange should now be impossible)');
