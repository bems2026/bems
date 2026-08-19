/**
 * Rotates the plaintext auth token hardcoded in the live "Auth + validate" function node
 * (id `bemsapi_auth`, "Switch" tab) that guards `POST /light/:id` — the real, already-
 * working entry point `server/proxy.mjs`'s Phase 7 dispatch forwards light commands to.
 * The token was found live, embedded in plaintext in the flow's own source, not a Node-RED
 * credential field or an env var — rotated as part of shipping Phase 7 dispatch.
 *
 * Also closes a fail-open hole a naive `env.get()` swap would introduce: if
 * LIGHT_API_TOKEN is ever unset, `env.get(...)` returns `undefined`, and a request sent
 * with NO `x-auth-token` header at all also reads as `undefined` — `undefined !== undefined`
 * is `false`, so the 401 branch would be skipped and an unauthenticated request would pass
 * straight through to the relay. The patch adds an explicit falsy-token guard.
 *
 * One-time, surgical — touches exactly one node's `.func`, nothing else on the live flow.
 * Never touches any DPS set/write path, the Outlet Router, or anything that itself commands
 * a relay; it only tightens what already gates the one relay-write route this repo forwards
 * commands to.
 *
 *     node node-red-bridge/rotate-light-api-token.mjs --host=<pi-ip> [--port=1880]          # dry run
 *     node node-red-bridge/rotate-light-api-token.mjs --host=<pi-ip> [--port=1880] --apply   # actually deploy
 *
 * See docs/phase-f-runbook.md-style operational sequencing in the Phase 7 plan for the full
 * rollout order this script is one step of — do not run --apply in isolation without first
 * setting LIGHT_API_TOKEN in /home/bems/.node-red/environment and restarting nodered.service,
 * or the rotated function will reject every request, including the real dashboard's own.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDotEnv, createAdminClient } from './nodeRedAdmin.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
loadDotEnv(join(HERE, '..'));

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const HOST = arg('host');
const PORT = Number(arg('port', 1880));
const TIMEOUT_MS = Number(arg('timeout', 8000));
const APPLY = flag('apply');

if (!HOST) {
  console.error('Usage: node node-red-bridge/rotate-light-api-token.mjs --host=<pi-ip> [--port=1880] [--apply]');
  process.exit(2);
}

const admin = createAdminClient({ host: HOST, port: PORT, timeoutMs: TIMEOUT_MS });

const NODE_ID = 'bemsapi_auth';
const FIND = `const TOKEN = '8f055d63d55cb01a2511880494939ef74fd64d2550425848';\nif (msg.req.headers['x-auth-token'] !== TOKEN) {`;
const REPLACE = `const TOKEN = env.get('LIGHT_API_TOKEN');\nif (!TOKEN || msg.req.headers['x-auth-token'] !== TOKEN) {`;

/** Applies find->replace and records it for the report — the dry-run report prints the
 * pair directly rather than line-diffing, which is the exact, unambiguous change either way. */
function applyExactPatch(text, find, replace, label, applied) {
  if (!text.includes(find)) {
    throw new Error(
      `Expected substring not found in ${label} — the live flow has drifted from what this script was verified against. Aborting rather than guessing.\n  Looking for: ${JSON.stringify(find)}`,
    );
  }
  applied.push({ find, replace });
  return text.split(find).join(replace);
}

async function main() {
  console.log(`${APPLY ? 'Applying' : 'Dry run (pass --apply to actually deploy)'} to http://${HOST}:${PORT}\n`);

  let authHeader;
  try {
    authHeader = await admin.login();
    if (authHeader) console.log(`Logged in as ${process.env.NODE_RED_ADMIN_USER} (adminAuth).\n`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  let liveFlows, rev;
  try {
    ({ flows: liveFlows, rev } = await admin.getFlows(authHeader));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  console.log(`Read ${liveFlows.length} existing nodes (rev ${rev}).\n`);

  const node = liveFlows.find((n) => n.id === NODE_ID);
  if (!node) throw new Error(`Node ${NODE_ID} ("Auth + validate") not found on the live instance — aborting.`);

  const applied = [];
  node.func = applyExactPatch(node.func, FIND, REPLACE, `${node.name} (${NODE_ID})`, applied);

  console.log(`--- ${node.name} (${NODE_ID}) ---`);
  for (const { find, replace } of applied) {
    for (const line of find.split('\n')) console.log(`  - ${line}`);
    for (const line of replace.split('\n')) console.log(`  + ${line}`);
  }
  console.log();

  if (!APPLY) {
    console.log('Dry run only — nothing was written. Re-run with --apply to deploy.');
    console.log('Before applying: confirm LIGHT_API_TOKEN is already set in /home/bems/.node-red/environment');
    console.log('and nodered.service has been restarted to pick it up — see the Phase 7 plan\'s rollout sequence.');
    return;
  }

  const deployRes = await admin.postFlows(authHeader, liveFlows, rev);
  if (deployRes.status === 409) {
    console.error('\nABORT: HTTP 409 — the flow was edited (in the Node-RED editor, presumably) between the GET and this POST.');
    console.error('Re-run this script to pick up the latest state.');
    process.exit(1);
  }
  if (!deployRes.ok) {
    console.error(`\nDeploy failed: HTTP ${deployRes.status}`);
    console.error(await deployRes.text().catch(() => ''));
    process.exit(1);
  }
  console.log('Deployed. The function node now reads LIGHT_API_TOKEN from env — confirm the environment');
  console.log('file is set correctly BEFORE relying on this (verify with the curl checks in the Phase 7 plan).');
}

main();
