#!/usr/bin/env node
/**
 * Reconnects any `tuya-smart-device` node whose STATUS output leads nowhere.
 *
 *     node node-red-bridge/fix-health-wiring.mjs --host=<pi>            # dry run
 *     node node-red-bridge/fix-health-wiring.mjs --host=<pi> --apply    # write it
 *
 * DRY RUN BY DEFAULT. Prints the plan and the invariant check; writes nothing without --apply.
 *
 * WHY. The parser that maintains `<ctx>_health` sets the flag `true` on connect or on any data
 * arriving, and `false` on `DISCONNECTED`/`ERROR` — but the false branch only ever fires on a
 * message from output 2. With output 2 unwired, the health flag cannot go false at all.
 *
 * Measured on the live flow 2026-09-01: of the three meter nodes, one was wired and two were
 * not, and those two feed three of the four metered channels. `buildLatest` drops an
 * `online: false` meter from the building totals and the accumulator gates on the same flag, so
 * a meter whose flag cannot go false keeps contributing its last frozen reading to the
 * building's kWh for as long as it stays disconnected. The ten-minute arrival rule was the only
 * thing catching it — the backstop doing the primary signal's job.
 *
 * This supersedes the first of `fix-tuya-health-signals.mjs`'s three fixes. That one worked from
 * a hardcoded list of node ids and now aborts before it can help, because its list names a
 * meter node the flow no longer has. Expressing the repair as an invariant instead — a data
 * output that goes somewhere and a status output that goes nowhere is wrong — needs no list and
 * survives the flow being edited. Its other two fixes (the parser `p.state` patch and the
 * accumulator gate) are already applied live and are not touched here.
 *
 * BACK UP `~/.node-red/flows.json` BEFORE APPLYING. These nodes live on the four hand-built
 * source tabs, where `findTimeout` and `tuyaVersion` exist and which nothing in this repo can
 * regenerate.
 *
 * The plan lives in `healthWiringPlan.mjs` so a dry run and an apply compute the same thing.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDotEnv, createAdminClient } from './nodeRedAdmin.mjs';
import { planHealthWiring, validateHealthWiring } from './healthWiringPlan.mjs';

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
  console.error('Usage: node node-red-bridge/fix-health-wiring.mjs --host=<pi> [--apply]');
  process.exit(2);
}

const client = createAdminClient({ host: HOST, port: PORT, timeoutMs: 20000 });
const auth = await client.login();
const { flows, rev } = await client.getFlows(auth);
console.log(`Read ${flows.length} nodes (rev ${rev}).\n`);

const { flows: next, changed } = planHealthWiring(flows);

if (changed.length === 0) {
  console.log('Every tuya node already has its status output wired. Nothing to do.');
  process.exit(0);
}

const live = changed.filter((c) => !c.quiesced);
console.log(`${changed.length} node(s) cannot currently report a disconnect:\n`);
for (const c of changed) {
  console.log(`  ${c.node}${c.quiesced ? '   [quiesced — this changes nothing until it is re-paired]' : ''}`);
  console.log(`    output 2: [] -> ${JSON.stringify(c.targets)}  (mirrors its own data output)`);
}
if (live.length !== changed.length) {
  console.log(`\n${live.length} of these are running; the rest are stopped on purpose (quiesce:pi).`);
  console.log('Wiring a stopped node costs nothing now and works the day it comes back.');
}

const problems = validateHealthWiring(flows, next);
if (problems.length) {
  console.error('\nINVARIANT CHECK FAILED — refusing to write:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('\nInvariants hold: no node added, removed, or otherwise modified.');

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write it — and back up ~/.node-red/flows.json first.');
  process.exit(0);
}

const res = await client.postFlows(auth, next, rev);
if (res.status === 409) {
  console.error('\nABORT: HTTP 409 — the flow changed between the read and this write. Re-run.');
  process.exit(1);
}
if (!res.ok) {
  console.error(`\nDeploy failed: HTTP ${res.status}`);
  console.error(await res.text().catch(() => ''));
  process.exit(1);
}
console.log('\nDeployed. A disconnect will now clear the health flag, which removes the device');
console.log('from the building totals instead of letting a frozen reading accumulate.');
