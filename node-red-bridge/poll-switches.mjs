#!/usr/bin/env node
/**
 * Adds a 60 s refresh for the light-switch nodes.
 *
 *     node node-red-bridge/poll-switches.mjs --host=<pi>            # dry run
 *     node node-red-bridge/poll-switches.mjs --host=<pi> --apply    # write it
 *
 * DRY RUN BY DEFAULT. Prints the plan and the invariant check; writes nothing without --apply.
 *
 * WHY. A light switch reports when its relay changes and at almost no other time, so the
 * countdown, power-on mode, switch type and inching setting it also holds may never arrive at
 * all. Measured on the Pi: all seven lights online, reporting relay state, carrying no
 * capabilities — while every outlet and meter had a full set, the outlets only because
 * `outletPollPlan` already asks them. This is that fix for the class it left out.
 *
 * BACK UP `~/.node-red/flows.json` BEFORE APPLYING. This writes to the Switch tab, one of the
 * four hand-built source tabs that carry `findTimeout` and `tuyaVersion` — values nothing in
 * this repository declares.
 *
 * AFTER APPLYING: restart is not required (an inject with `once` starts on deploy), but give it
 * a minute and then read `/api/readings/latest` back: every online light should carry a
 * `capabilities` object. An HTTP 2xx from the admin API means the flow was accepted, not that a
 * device answered.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDotEnv, createAdminClient } from './nodeRedAdmin.mjs';
import { planSwitchPoll, validateSwitchPoll, POLL_INTERVAL_S } from './switchPollPlan.mjs';

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
  console.error('Usage: node node-red-bridge/poll-switches.mjs --host=<pi> [--apply]');
  process.exit(2);
}

const client = createAdminClient({ host: HOST, port: PORT, timeoutMs: 20000 });
const auth = await client.login();
const { flows, rev } = await client.getFlows(auth);
console.log(`Read ${flows.length} nodes (rev ${rev}).\n`);

const plan = planSwitchPoll(flows);

if (plan.unchanged) {
  console.log(`Nothing to do: ${plan.reason}`);
  process.exit(0);
}

const verb = plan.upgraded ? 'upgraded' : 'added';
console.log(`Poller will be ${verb} for ${plan.targets.length} switch(es), every ${POLL_INTERVAL_S}s:`);
for (const t of plan.targets) console.log(`  ${t}`);
console.log('\nA light already flagged disconnected is skipped; one with no health entry is polled.');

const problems = validateSwitchPoll(flows, plan.flows);
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
console.log('\nDeployed. Give it a minute, then read /api/readings/latest back — every online');
console.log('light should carry a `capabilities` object. A 2xx here is the flow being accepted,');
console.log('not a device having answered.');
