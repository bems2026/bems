#!/usr/bin/env node
/**
 * Puts the channel demux in front of the shared dual-channel meter's parsers, in the live flow.
 *
 *     node node-red-bridge/demux-channels.mjs --host=<pi>            # dry run
 *     node node-red-bridge/demux-channels.mjs --host=<pi> --apply    # write it
 *
 * DRY RUN BY DEFAULT. Prints the plan and the invariant check; writes nothing without --apply.
 *
 * Why (ROADMAP RM-122): the yellow CT meter reports its two clamps under each other's dp ranges,
 * on its own, for hours at a time — 2026-09-19 06:21–17:20, 2026-09-21 05:08–09:44 and four short
 * flips that day. One session feeds two parsers keyed on dp number, so nothing here could have
 * traded them; the device did. The node this adds decides from two physical facts the operator
 * confirmed (the lighting branch's ceiling, the outlet branch never idle) and renumbers the dps
 * before any parser reads them, so every consumer downstream sees each circuit under its own name.
 *
 * This patch ADDS one node and moves one wire. The plan lives in `channelDemuxPlan.mjs` so a dry
 * run and an apply compute the same thing, and `test/channel-demux-plan.test.mjs` executes the
 * node's code rather than pattern-matching it.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDotEnv, createAdminClient } from './nodeRedAdmin.mjs';
import { BUILT_IN_DEVICES, SITE } from '../shared/registry.mjs';
import { planChannelDemux, validateChannelDemux } from './channelDemuxPlan.mjs';

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
  console.error('Usage: node node-red-bridge/demux-channels.mjs --host=<pi> [--apply]');
  process.exit(2);
}

const client = createAdminClient({ host: HOST, port: PORT, timeoutMs: 20000 });
const auth = await client.login();
const { flows, rev } = await client.getFlows(auth);
console.log(`Read ${flows.length} nodes (rev ${rev}).\n`);

const plan = planChannelDemux(flows, { site: SITE, registry: BUILT_IN_DEVICES });
if (plan.unchanged) {
  console.log(`Nothing to do — ${plan.reason}.`);
  process.exit(0);
}

console.log('=== PLAN ===');
for (const pair of SITE.channel_demux) {
  console.log(`  ${pair.devices.join(' / ')}: any channel above ${pair.ceiling_w} W is ${pair.never_idle}; a channel at 0 W / 0 A is the other.`);
}
if (plan.added.length) console.log(`  add ${plan.added.length} node(s): ${plan.added.join(', ')}; move the data wire of ${plan.rewired.length} tuya node(s) through it`);
if (plan.upgraded.length) console.log(`  replace the code of ${plan.upgraded.length} existing demux node(s): ${plan.upgraded.join(', ')}`);
if (plan.reason) console.log(`  skipped: ${plan.reason}`);
console.log(`\nResulting flow size: ${flows.length} -> ${plan.flows.length} nodes.\n`);

console.log('=== INVARIANTS ===');
const problems = validateChannelDemux(flows, plan.flows, plan);
if (problems.length) {
  for (const p of problems) console.error(`  FAIL  ${p}`);
  console.error('\nABORT: the plan violates an invariant. Nothing was written.');
  process.exit(1);
}
console.log(plan.added.length ? '  OK  exactly the planned node(s) added' : '  OK  no nodes added; only demux code changed');
console.log('  OK  no other existing node modified or removed');
console.log('  OK  the tuya session\'s status output still reaches the parsers directly');
console.log('  OK  each demux is fed by one session and feeds exactly two parsers');
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
console.log('Applied.');
console.log('Verify: GET /api/readings/latest should carry channel_assignment on both meters once the');
console.log('bridge tab is redeployed (npm run build:flow && npm run deploy:pi -- --force --apply), and');
console.log('npm run check:meters -- --hours=6 should find no interchange in the STORED rows after the');
console.log('next flip — the device still flips; the rows no longer follow it.');
