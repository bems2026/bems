#!/usr/bin/env node
/**
 * Removes dead nodes from the live Node-RED flow. See cleanupPlan.mjs for what and why.
 *
 *     node node-red-bridge/prune-dead-flow.mjs --host=<pi>            # dry run, writes nothing
 *     node node-red-bridge/prune-dead-flow.mjs --host=<pi> --apply    # actually deploys
 *
 * Follows the same discipline as deploy.mjs and the two fix scripts: dry run by default, an
 * explicit --apply to write, and a revision check so a flow edited in the editor since this
 * script read it is never silently clobbered.
 *
 * Take a backup on the Pi first (`~/backups/node-red/`) — this deletes nodes, and the repo's
 * committed baseline is redacted and therefore NOT restorable on its own.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDotEnv, createAdminClient } from './nodeRedAdmin.mjs';
import { planCleanup, DEAD_ENDPOINTS } from './cleanupPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
loadDotEnv(join(HERE, '..'));

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const HOST = arg('host', '127.0.0.1');
const PORT = Number(arg('port', '1880'));
const APPLY = process.argv.includes('--apply');

async function main() {
  const client = createAdminClient({ host: HOST, port: PORT, timeoutMs: 20000 });
  const auth = await client.login();
  const { flows, rev } = await client.getFlows(auth);
  console.log(`[prune] read ${flows.length} nodes from ${HOST}:${PORT} (rev ${String(rev).slice(0, 8)}…)\n`);

  const plan = planCleanup(flows);

  const byReason = {};
  for (const node of plan.remove) {
    const why = plan.reasons[node.id];
    (byReason[why] ??= []).push(node);
  }

  console.log('=== TO REMOVE ===');
  for (const [why, nodes] of Object.entries(byReason)) {
    console.log(`\n  ${nodes.length} x ${why}`);
    const types = {};
    for (const n of nodes) types[n.type] = (types[n.type] || 0) + 1;
    for (const [t, c] of Object.entries(types).sort((a, b) => b[1] - a[1])) console.log(`      ${String(c).padStart(3)}  ${t}`);
  }

  const tabs = Object.fromEntries(flows.filter((n) => n.type === 'tab').map((t) => [t.id, t.label]));
  console.log('\n=== ORPHANS (reported only, nothing deleted) ===');
  if (!plan.orphans.length) console.log('  none — no surviving node lost all of its consumers');
  for (const o of plan.orphans) console.log(`  ${o.type} ${JSON.stringify(o.name)} on ${JSON.stringify(tabs[o.z] ?? o.z)}`);

  console.log(`\n=== TOTAL: ${flows.length} -> ${plan.flows.length} nodes (${plan.remove.length} removed) ===`);

  // Guard rails. These are the invariants that make this safe to run unattended; if any is
  // violated the plan is wrong and applying it would do damage.
  const survivingTypes = new Set(plan.flows.map((n) => n.type));
  const problems = [];
  if (plan.flows.filter((n) => n.type === 'tab').length !== flows.filter((n) => n.type === 'tab').length) problems.push('a tab would be deleted');
  if (!survivingTypes.has('tuya-smart-device')) problems.push('no tuya devices would survive');
  // Endpoints may only disappear if they are ones this cleanup explicitly targets. A blanket
  // count check would either block the intended removals or, once relaxed, stop noticing an
  // unintended one — so compare the actual sets instead.
  const urlsBefore = new Set(flows.filter((n) => n.type === 'http in').map((n) => n.url));
  const urlsAfter = new Set(plan.flows.filter((n) => n.type === 'http in').map((n) => n.url));
  const droppedUrls = [...urlsBefore].filter((u) => !urlsAfter.has(u));
  const unexpected = droppedUrls.filter((u) => !DEAD_ENDPOINTS.includes(u));
  if (unexpected.length) problems.push(`unexpected HTTP endpoint(s) removed: ${unexpected.join(', ')}`);
  // The reachability sweep is powerful enough to remove things nobody listed, so the things
  // that must NEVER go are asserted by name rather than by count.
  const survives = (pred, what) => {
    if (!plan.flows.some(pred)) problems.push(`${what} would be removed`);
  };
  survives((n) => n.type === 'http in' && n.url === '/light/:id', 'POST /light/:id (the live dispatch path)');
  survives((n) => n.name === 'Lighting Logic Hub', 'Lighting Logic Hub');
  survives((n) => n.name === 'Outlet Logic Hub', 'Outlet Logic Hub');
  survives((n) => n.name === 'AC Master Logic', 'AC Master Logic');
  survives((n) => n.type === 'websocket-listener', 'the websocket-listener behind /ws/live');
  survives((n) => n.type === 'websocket out', 'the /ws/live publisher');
  const gsBefore = flows.filter((n) => n.type === 'GSheet').length;
  const gsAfter = plan.flows.filter((n) => n.type === 'GSheet').length;
  if (gsBefore !== gsAfter) problems.push(`Google Sheets logging changed ${gsBefore} -> ${gsAfter} (it is meant to be kept)`);
  const apiBefore = flows.filter((n) => n.type === 'http in' && n.url.startsWith('/api/')).length;
  const apiAfter = plan.flows.filter((n) => n.type === 'http in' && n.url.startsWith('/api/')).length;
  if (apiBefore !== apiAfter) problems.push(`/api/* endpoints changed ${apiBefore} -> ${apiAfter}`);
  const tuyaBefore = flows.filter((n) => n.type === 'tuya-smart-device').length;
  const tuyaAfter = plan.flows.filter((n) => n.type === 'tuya-smart-device').length;
  if (tuyaBefore !== tuyaAfter) problems.push(`tuya devices changed ${tuyaBefore} -> ${tuyaAfter}`);
  if (problems.length) {
    console.error('\n[prune] REFUSING — the plan violates a safety invariant:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('[prune] safety invariants hold: the dispatch endpoint, all three control hubs, the live feed, /api/*, Google Sheets and every Tuya device survive.');

  if (!APPLY) {
    console.log('\n[prune] DRY RUN — nothing written. Re-run with --apply to deploy.');
    return;
  }

  // postFlows takes (authHeader, flows, rev) and returns the raw Response — it does NOT throw
  // on a non-2xx. An earlier version of this script passed those arguments in the wrong order
  // AND ignored the status, so a malformed request printed "Deployed." while the live flow was
  // untouched. Both halves of that mistake are guarded below, matching rotate-light-api-token.mjs.
  // postFlows takes (authHeader, flows, rev) and returns the raw Response — it does NOT throw
  // on a non-2xx. An earlier version of this script passed those arguments in the wrong order
  // AND ignored the status, so a malformed request printed a success line while the live flow
  // was untouched. Both halves are guarded below, matching rotate-light-api-token.mjs.
  const res = await client.postFlows(auth, plan.flows, rev);
  if (res.status === 409) {
    console.error('[prune] ABORT: HTTP 409 — the flow changed between the read and this write.');
    console.error('[prune] Re-run to pick up the current state.');
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`[prune] Deploy failed: HTTP ${res.status}`);
    console.error(await res.text().catch(() => ''));
    process.exit(1);
  }

  // Trust nothing: read the flow back and confirm the node count actually moved.
  const after = await client.getFlows(auth);
  if (after.flows.length !== plan.flows.length) {
    console.error(`[prune] Reported success but the live flow has ${after.flows.length} nodes, expected ${plan.flows.length}.`);
    process.exit(1);
  }
  console.log(`[prune] Deployed and verified: live flow is now ${after.flows.length} nodes.`);
}

main().catch((err) => {
  console.error(`[prune] ${err.message}`);
  process.exit(1);
});
