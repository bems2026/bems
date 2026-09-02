#!/usr/bin/env node
/**
 * Regenerates the source-tab dp parsers from the capability catalogue.
 *
 *     node node-red-bridge/fix-dp-parsers.mjs --host=<pi>            # dry run
 *     node node-red-bridge/fix-dp-parsers.mjs --host=<pi> --apply    # write it
 *
 * DRY RUN BY DEFAULT. Prints the plan and the invariant check; writes nothing without --apply.
 *
 * WHY. Every dp this system reads is decoded by a hand-written function node on one of the four
 * source tabs, which `build-flow.mjs` deliberately does not generate. Nothing in this repository
 * declares them, so what the building measures can change with no diff and no alarm — and it
 * had: the outlet parsers read `add_ele` at the wrong scale AND treated an increment as a total,
 * and nothing reset an outlet's energy at midnight. See `dpParserPlan.mjs` for the detail.
 *
 * BACK UP `~/.node-red/flows.json` BEFORE APPLYING. These are the same tabs that carry
 * `findTimeout` and `tuyaVersion`, which nothing here can regenerate.
 *
 * AFTER APPLYING: restart Node-RED, then read `/api/readings/latest` back. An outlet's
 * `energy_kwh_today` should start climbing plausibly against its wattage instead of sitting in
 * hundredths, and each meter should carry its own `today_acc_energy` on `<ctx>_dp`.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDotEnv, createAdminClient } from './nodeRedAdmin.mjs';
import { planDpParsers, applyDpParserPlan, validateDpParserPlan, keysWrittenBy } from './dpParserPlan.mjs';
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
const VERBOSE = process.argv.includes('--verbose');

if (!HOST) {
  console.error('Usage: node node-red-bridge/fix-dp-parsers.mjs --host=<pi> [--apply] [--verbose]');
  process.exit(2);
}

const client = createAdminClient({ host: HOST, port: PORT, timeoutMs: 20000 });
const auth = await client.login();
const { flows, rev } = await client.getFlows(auth);
console.log(`Read ${flows.length} nodes (rev ${rev}).\n`);

const plan = planDpParsers(flows, { registry: DEVICE_REGISTRY });

if (plan.warnings.length) {
  console.log('Not rewritten — review these by hand:');
  for (const w of plan.warnings) {
    console.log(`  ${w.device}${w.name ? ` · ${w.name}` : ''}: ${w.reason}`);
  }
  console.log('');
}

if (plan.skipped.length) {
  console.log(`${plan.skipped.length} parser(s) already generated and current.`);
}

if (plan.changes.length === 0) {
  console.log('Every parser already matches the capability catalogue. Nothing to do.');
  process.exit(0);
}

console.log(`${plan.changes.length} parser(s) would be regenerated:\n`);
for (const c of plan.changes) {
  const kept = [...keysWrittenBy(c.before)].length;
  console.log(`  ${c.device.padEnd(14)} ${c.name}`);
  console.log(`    ${c.before.length} -> ${c.after.length} bytes · ${kept} context key(s) preserved` +
    `${c.wasGenerated ? '' : ' · currently HAND-WRITTEN'}`);
  if (VERBOSE) console.log(`\n${c.after}\n`);
}

const next = applyDpParserPlan(flows, plan);
const problems = validateDpParserPlan(flows, next, plan);
if (problems.length) {
  console.error('\nINVARIANT CHECK FAILED — refusing to write:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('\nInvariants hold: no node added, removed, or changed beyond its code, and every');
console.log('context key these parsers used to write is still written.');

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
console.log('\nDeployed. Restart Node-RED, then read /api/readings/latest back — an HTTP 200 from');
console.log('the admin API means the flow was accepted, not that a parser produced a right number.');
