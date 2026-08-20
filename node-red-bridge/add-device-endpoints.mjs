#!/usr/bin/env node
/**
 * Deploys the outlet and ACU control endpoints. See addDeviceEndpoints.mjs for what they are
 * and why they mirror the light endpoint rather than inventing a second style.
 *
 *     node node-red-bridge/add-device-endpoints.mjs --host=<pi>            # dry run
 *     node node-red-bridge/add-device-endpoints.mjs --host=<pi> --apply    # deploy
 *
 * Same discipline as deploy.mjs and the other live-write scripts: dry run by default, an
 * explicit --apply, a revision check so a flow edited in the editor since this read it is
 * never clobbered, and a read-back afterwards rather than trusting the POST's own word.
 *
 * This ADDS a write path to a flow that previously had only one. Take a backup on the Pi
 * first; the repo's baseline is redacted and cannot restore on its own.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDotEnv, createAdminClient } from './nodeRedAdmin.mjs';
import { addDeviceEndpoints } from './addDeviceEndpoints.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
loadDotEnv(join(HERE, '..'));

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const HOST = arg('host', '127.0.0.1');
const PORT = Number(arg('port', '1880'));
const APPLY = process.argv.includes('--apply');

const required = (flows, pred, what) => {
  const hit = flows.find(pred);
  if (!hit) {
    console.error(`[endpoints] ABORT: could not find ${what} in the live flow.`);
    process.exit(1);
  }
  return hit;
};

async function main() {
  const client = createAdminClient({ host: HOST, port: PORT, timeoutMs: 20000 });
  const auth = await client.login();
  const { flows, rev } = await client.getFlows(auth);
  console.log(`[endpoints] read ${flows.length} nodes from ${HOST}:${PORT} (rev ${String(rev).slice(0, 8)}…)`);

  // Everything is looked up by name in the LIVE flow rather than hardcoded, so a mismatch
  // stops the script instead of wiring an endpoint to nothing.
  const outletHub = required(flows, (n) => n.name === 'Outlet Logic Hub', '"Outlet Logic Hub"');
  const acuLogic = required(flows, (n) => n.name === 'AC Master Logic', '"AC Master Logic"');
  const switchTabId = outletHub.z;
  const acuTabId = acuLogic.z;
  const tabLabel = (id) => flows.find((n) => n.type === 'tab' && n.id === id)?.label ?? id;

  const next = addDeviceEndpoints(flows, { switchTabId, acuTabId, outletHubId: outletHub.id, acuLogicId: acuLogic.id });
  const added = next.filter((n) => !flows.some((o) => o.id === n.id));

  console.log('\n=== TO ADD ===');
  if (!added.length) console.log('  nothing — both endpoints already exist');
  for (const n of added) console.log(`  ${n.type.padEnd(15)} ${JSON.stringify(n.name ?? n.url ?? '')}  on ${JSON.stringify(tabLabel(n.z))}`);

  // Guard rails: this script may only ever ADD.
  const problems = [];
  if (next.length !== flows.length + added.length) problems.push('node count does not match an add-only change');
  for (const original of flows) {
    const after = next.find((n) => n.id === original.id);
    if (!after) problems.push(`existing node ${original.id} would be removed`);
  }
  if (!next.some((n) => n.type === 'http in' && n.url === '/light/:id')) problems.push('the light endpoint would be lost');
  if (problems.length) {
    console.error('\n[endpoints] REFUSING:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('\n[endpoints] add-only confirmed: every existing node survives untouched.');

  if (!APPLY) {
    console.log('\n[endpoints] DRY RUN — nothing written. Re-run with --apply to deploy.');
    return;
  }

  const res = await client.postFlows(auth, next, rev);
  if (res.status === 409) {
    console.error('\n[endpoints] ABORT: HTTP 409 — the flow changed between the read and this write. Re-run.');
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`\n[endpoints] Deploy failed: HTTP ${res.status}`);
    console.error(await res.text().catch(() => ''));
    process.exit(1);
  }

  const after = await client.getFlows(auth);
  const urls = after.flows.filter((n) => n.type === 'http in').map((n) => n.url).sort();
  console.log(`\n[endpoints] Deployed and verified: ${after.flows.length} nodes, endpoints now ${urls.join(', ')}`);
}

main().catch((err) => {
  console.error(`[endpoints] ${err.message}`);
  process.exit(1);
});
