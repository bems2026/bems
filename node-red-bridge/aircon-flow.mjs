#!/usr/bin/env node
/**
 * Applies the Aircon tab refactor for the re-paired IR hub. See airconFlowPlan.mjs for what it
 * changes and airconSources.mjs for why.
 *
 *     npm run aircon:pi -- --host=127.0.0.1                    # dry run: prints the plan
 *     npm run aircon:pi -- --host=127.0.0.1 --apply            # writes it
 *     npm run aircon:pi -- --host=127.0.0.1 --keep-quiesced    # everything except waking the blaster
 *
 * Same discipline as the other live-write scripts: dry run by default, an explicit --apply, the
 * flow's revision sent back so an edit made in the editor since this read it is never clobbered,
 * the plan checked by its invariants before anything is written, and a read-back afterwards that
 * re-plans the live flow and expects nothing left to do — rather than trusting the POST.
 *
 * TAKE A BACKUP ON THE PI FIRST. The Aircon tab holds the only copy of the IR code library and
 * the only find timeout / protocol version for two devices; the repository's baseline is redacted
 * and cannot restore it:
 *     cp ~/.node-red/flows.json ~/.node-red/flows.json.bak-aircon-$(date +%F)
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDotEnv, createAdminClient } from './nodeRedAdmin.mjs';
import { planAircon, validateAirconPlan } from './airconFlowPlan.mjs';
import { DEVICE_REGISTRY, SITE } from '../shared/registry.mjs';

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
const ENABLE_HUB = !process.argv.includes('--keep-quiesced');
// The site's declared IR protocol (2026-09-22): with one, AC Master Logic also generates frames for
// states its captured library lacks. The plan refuses unless the generator rebuilds every captured code.
const IR_PROTOCOL = SITE.aircon?.ir_protocol ?? null;

// The blaster's node name comes from the registry, not from this script.
const acu = DEVICE_REGISTRY.find((d) => d.class === 'acu_ir' && d.flow_node);
if (!acu) {
  console.error('[aircon] ABORT: no acu_ir device in the registry declares a flow_node.');
  process.exit(1);
}

console.log(`[aircon] ${APPLY ? 'Applying' : 'Dry run (pass --apply to write)'} to http://${HOST}:${PORT}`);
console.log(`[aircon] aircon ${acu.id} via node "${acu.flow_node}"${ENABLE_HUB ? '' : ' (keeping it quiesced)'}; IR protocol ${IR_PROTOCOL ?? 'none (captured library only)'}\n`);

const admin = createAdminClient({ host: HOST, port: PORT, timeoutMs: 20000 });
const auth = await admin.login();
const { flows, rev } = await admin.getFlows(auth);
console.log(`[aircon] read ${flows.length} nodes (rev ${String(rev).slice(0, 8)}…)`);

const plan = planAircon(flows, { flowNode: acu.flow_node, enableHub: ENABLE_HUB, irProtocol: IR_PROTOCOL });
if (plan.problems.length) {
  console.error('\n[aircon] Refused:');
  for (const p of plan.problems) console.error(`  - ${p}`);
  process.exit(1);
}

const invalid = validateAirconPlan(flows, plan.flows, plan);
if (invalid.length) {
  console.error('\n[aircon] Refused by the invariants:');
  for (const p of invalid) console.error(`  - ${p}`);
  process.exit(1);
}

if (!plan.changes.length && !plan.added.length && !plan.removed.length) {
  console.log('\n[aircon] Nothing to do — the Aircon tab is already current.');
  process.exit(0);
}

console.log('\n=== CHANGE ===');
for (const c of plan.changes) console.log(`  ~ ${c.name}`);
for (const id of plan.removed) console.log(`  - ${id}`);
for (const id of plan.added) console.log(`  + ${plan.flows.find((n) => n.id === id)?.name ?? id}`);
console.log(`\nNode count: ${flows.length} -> ${plan.flows.length}`);
console.log('Unchanged by design: Outside Temp, Extract DP 103, every tuya id/key/version/find timeout, the IR library.');
if (IR_PROTOCOL) console.log(`Generator check passed: every captured ON code was rebuilt exactly as ${IR_PROTOCOL} before this plan was allowed.`);

if (!APPLY) {
  console.log('\n[aircon] Dry run only — nothing was written. Re-run with --apply.');
  process.exit(0);
}

const res = await admin.postFlows(auth, plan.flows, rev);
if (res.status === 409) {
  console.error('\n[aircon] The flow changed between the read and this write. Nothing was written; re-run.');
  process.exit(1);
}
if (!res.ok) {
  console.error(`\n[aircon] Node-RED refused the write (HTTP ${res.status}). Nothing changed.`);
  process.exit(1);
}

// Read back and re-plan: a correct write leaves nothing to do.
const { flows: live } = await admin.getFlows(auth);
const again = planAircon(live, { flowNode: acu.flow_node, enableHub: ENABLE_HUB, irProtocol: IR_PROTOCOL });
if (again.problems.length || again.changes.length || again.added.length || again.removed.length) {
  console.error('\n[aircon] WRITTEN, BUT THE READ-BACK DISAGREES. Inspect the Aircon tab before doing anything else:');
  for (const p of again.problems) console.error(`  - ${p}`);
  for (const c of again.changes) console.error(`  still differs: ${c.name}`);
  process.exit(1);
}
console.log('\n[aircon] Written and read back: the Aircon tab is current.');
console.log('Confirm the hub connects:  sudo journalctl -u nodered --since "-2 min" | grep "NBRIC IR Blaster"');
console.log('Confirm the reading:       curl -s http://127.0.0.1:1880/api/readings/latest | grep -o \'"device_id":"acu_main"[^}]*\'');
