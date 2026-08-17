/**
 * Deploys `bridge-flow.json` to a live Node-RED instance via its Admin API.
 *
 *     node node-red-bridge/deploy.mjs --host=<pi-ip> [--port=1880]          # dry run
 *     node node-red-bridge/deploy.mjs --host=<pi-ip> [--port=1880] --apply  # actually deploy
 *
 * If the target instance has `adminAuth` configured (Node-RED's editor/Admin-API login —
 * a separate setting from `httpNodeCors`/`httpNodeAuth`, which gate the deployed HTTP-IN
 * endpoints this bridge itself serves, not this script's own access to `/flows`), set:
 *
 *     NODE_RED_ADMIN_USER=...
 *     NODE_RED_ADMIN_PASS=...
 *
 * in `.env` (gitignored — never commit real credentials) or the environment before running
 * this script. It logs in once via Node-RED's own `/auth/token` (the same flow the editor's
 * login page uses) and attaches the resulting bearer token to every Admin API call. Without
 * adminAuth on the target, leave these unset — every call proceeds exactly as before.
 *
 * Dry-run by default — never writes anything without `--apply`. Even with `--apply`,
 * it refuses to touch anything unless every safety check below passes:
 *
 *   1. The four source tabs the generated collectors attach to (Energy Monitoring,
 *      Outlet, Switch, Aircon — see node-red-bridge/build-flow.mjs SOURCE_TABS) must
 *      exist on the live instance with matching ids AND labels. This machine's tab ids
 *      were read from a dev copy of flows.json, not the real Pi — if they don't match,
 *      deploying would either silently attach to the wrong tab or fail outright, so this
 *      aborts loudly instead of guessing.
 *   2. No node id in bridge-flow.json may already exist on the live instance (defensive;
 *      should never trigger given the b41d9e/b41dc0 id prefixes, but a live flow is not
 *      something to find out the hard way).
 *   3. If the bridge tab is already deployed (same tab id present), this refuses to
 *      deploy a duplicate — pass --force to replace it (e.g. after regenerating
 *      bridge-flow.json from an updated shared/registry.mjs).
 *
 * Deploys via `POST /flows` with `Node-RED-Deployment-Type: nodes` (restarts only the
 * nodes that changed, not the whole runtime) and passes the `rev` read from `GET /flows`
 * so a concurrent edit in the Node-RED editor causes a conflict instead of being
 * silently overwritten.
 *
 * One of two scripts in this repo that mutate a live system (the other is
 * `fix-tuya-health-signals.mjs`) — both share their Admin API login/fetch/GET-then-POST
 * machinery via `nodeRedAdmin.mjs` rather than duplicating it. Read this before running it
 * with --apply against real hardware.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
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
const FORCE = flag('force');

if (!HOST) {
  console.error('Usage: node node-red-bridge/deploy.mjs --host=<pi-ip> [--port=1880] [--apply] [--force]');
  process.exit(2);
}

const BASE = `http://${HOST}:${PORT}`;
const BRIDGE_TAB_ID = 'b41d9e0000000001';

/**
 * Must match SOURCE_TABS in build-flow.mjs exactly — this is the cross-check that catches
 * a stale copy of flows.json before it corrupts a real deploy. NOT imported from
 * build-flow.mjs directly: that script has no exports and runs its whole generator (writes
 * bridge-flow.json, logs to stdout) as a top-level side effect on load, so importing it here
 * would silently regenerate the flow file as a side effect of a dry run. Duplicated instead,
 * same tradeoff `tokens.ts` makes on the frontend side (see that file's own header) — a
 * drift-guard comment instead of a shared import.
 *
 * Corrected 2026-08-13 against a real deploy target (192.168.1.190): the previous values
 * here were themselves already stale — different ids than BOTH build-flow.mjs's own
 * (correct, SSH-verified 2026-08-10) SOURCE_TABS and the actual Pi. Two independent
 * hardcoded copies of the same fact drifted from each other, which is exactly the failure
 * mode importing would have prevented — if these two ever need to change again, update
 * `SOURCE_TABS` in build-flow.mjs FIRST and copy its values here, not the reverse.
 */
const EXPECTED_SOURCE_TABS = {
  b91949ed325c0ab6: 'Energy Monitoring - Set time',
  f034cec8ea750f69: 'Outlet',
  '5ba0bb77c042d889': 'Switch',
  '5ae2a6bf87435d7a': 'Aircon',
};

const admin = createAdminClient({ host: HOST, port: PORT, timeoutMs: TIMEOUT_MS });

function loadBridgeNodes() {
  const raw = readFileSync(join(HERE, 'bridge-flow.json'), 'utf8');
  const nodes = JSON.parse(raw);
  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new Error('bridge-flow.json is empty or malformed — run `npm run build:flow` first');
  }
  return nodes;
}

async function main() {
  console.log(`${APPLY ? 'Deploying' : 'Dry run (pass --apply to actually deploy)'} to ${BASE}\n`);

  const bridgeNodes = loadBridgeNodes();

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
    console.error('Is the Pi on this network, and is Node-RED running on that port?');
    process.exit(1);
  }
  console.log(`Read ${liveFlows.length} existing nodes (rev ${rev}).\n`);

  // --- Safety check 1: source tabs must exist with matching ids AND labels ---
  const liveTabs = new Map(liveFlows.filter((n) => n.type === 'tab').map((n) => [n.id, n.label]));
  let tabsOk = true;
  for (const [id, expectedLabel] of Object.entries(EXPECTED_SOURCE_TABS)) {
    const liveLabel = liveTabs.get(id);
    if (liveLabel === undefined) {
      console.error(`ABORT: expected source tab "${expectedLabel}" (id ${id}) does not exist on this Node-RED instance.`);
      tabsOk = false;
    } else if (liveLabel !== expectedLabel) {
      console.error(`ABORT: tab ${id} is labeled "${liveLabel}" here, not "${expectedLabel}" as build-flow.mjs expects.`);
      tabsOk = false;
    } else {
      console.log(`OK  source tab "${expectedLabel}" (${id}) matches.`);
    }
  }
  if (!tabsOk) {
    console.error(
      '\nThe tab ids baked into node-red-bridge/build-flow.mjs came from a dev copy of flows.json, not this ' +
        'instance. Update SOURCE_TABS in build-flow.mjs to match this Pi’s real tab ids/labels, regenerate ' +
        '(`npm run build:flow`), and re-run this script.',
    );
    process.exit(1);
  }

  // --- Safety check 2: idempotency — is the bridge tab already deployed? ---
  // This MUST run before the general collision check below: the bridge tab's own id
  // (and, on a --force redeploy, its old nodes' ids) are expected to already be present
  // in that case, and checking collisions against raw liveFlows first would misreport a
  // legitimate prior deployment as a fatal id clash.
  const liveIds = new Set(liveFlows.map((n) => n.id));
  const alreadyDeployed = liveIds.has(BRIDGE_TAB_ID);
  let baseFlows = liveFlows;
  if (alreadyDeployed) {
    if (!FORCE) {
      console.log('The iBEMS bridge tab is already deployed on this instance. Nothing to do.');
      console.log('(Regenerated bridge-flow.json and want to replace it? Re-run with --force.)');
      process.exit(0);
    }
    console.log('--force given: removing the previously deployed bridge nodes before re-adding.');
    const bridgeIds = new Set(bridgeNodes.map((n) => n.id));
    // The bridge tab id is fixed across regenerations, but per-node ids inside it are
    // sequential and NOT guaranteed stable across a build-flow.mjs re-run — so the old
    // deployment is identified by z === old bridge tab id or being the tab itself, not
    // by id-for-id matching against the newly generated set.
    baseFlows = liveFlows.filter((n) => n.id !== BRIDGE_TAB_ID && n.z !== BRIDGE_TAB_ID && !bridgeIds.has(n.id));
  }

  // --- Safety check 3: no node id collisions against whatever remains ---
  const baseIds = new Set(baseFlows.map((n) => n.id));
  const collisions = bridgeNodes.filter((n) => baseIds.has(n.id)).map((n) => n.id);
  if (collisions.length) {
    console.error(`\nABORT: ${collisions.length} node id(s) already exist on the live instance: ${collisions.join(', ')}`);
    process.exit(1);
  }
  console.log('OK  no node id collisions.\n');

  const merged = baseFlows.concat(bridgeNodes);

  console.log(`\nPlan: add ${bridgeNodes.length} nodes (1 new tab, ${bridgeNodes.filter((n) => n.type === 'http in').length} HTTP endpoints, `);
  console.log(`      ${bridgeNodes.filter((n) => n.type === 'websocket out').length} WS output, collectors on the 4 tabs verified above).`);
  console.log(`Resulting flow size: ${liveFlows.length} → ${merged.length} nodes.\n`);

  if (!APPLY) {
    console.log('Dry run only — nothing was written. Re-run with --apply to deploy.');
    return;
  }

  const deployRes = await admin.postFlows(authHeader, merged, rev);

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

  console.log('Deployed.\n');
  console.log('Still required before this is fully live (this script has no filesystem access to the Pi):');
  console.log('  - enable contextStorage.localfilesystem in settings.js (docs/bridge-contract.md §Deployment)');
  console.log('  - enable httpNodeCors in settings.js if the dashboard will be served from a different origin/LAN device');
  console.log('  - restart Node-RED after editing settings.js, then re-run verify.mjs\n');

  console.log('Running post-deploy verification (node-red-bridge/verify.mjs)...\n');
  const verify = spawnSync(process.execPath, [join(HERE, 'verify.mjs'), `--host=${HOST}`, `--port=${PORT}`], {
    stdio: 'inherit',
  });
  process.exitCode = verify.status ?? 1;
}

main();
