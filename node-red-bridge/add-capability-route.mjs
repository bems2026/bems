#!/usr/bin/env node
/**
 * Adds the local capability-write route to the live flow — FI-022.
 *
 *     node node-red-bridge/add-capability-route.mjs --host=<pi>            # dry run
 *     node node-red-bridge/add-capability-route.mjs --host=<pi> --apply
 *
 * Dry run by default, like every other flow writer here.
 *
 * WHAT THIS WRITES, and why it is a separate script rather than part of `deploy:pi`. `deploy:pi`
 * touches only the generated bridge tab and read-only collectors that are wired to nothing; that
 * property is worth keeping, because it is what makes deploying safe to do casually. This adds
 * nodes to a HAND-BUILT tab and wires them into real devices, so it is its own act, with its own
 * dry run and its own validator.
 *
 * WHY THE METERS ONLY. The three tuya nodes on the Energy tab are fed today by nothing but
 * `Discovery back-off` and `Stale address recovery` — there is no command path to disturb — and
 * a CT meter has no relay. The worst a bug here can do is set a wrong alarm threshold. Doing the
 * same for outlets and switches means ~20 nodes wired beside live relay control, which is a
 * different risk and a separate decision.
 *
 * BACK UP `~/.node-red/flows.json` BEFORE APPLYING.
 *
 * AFTER APPLYING: restart Node-RED, then POST a real write and read the value back off the
 * device — an HTTP 200 means the flow accepted the message, not that a register moved. This
 * project has twice been burned by a 2xx that changed nothing.
 */
import { loadDotEnv, createAdminClient } from './nodeRedAdmin.mjs';
import {
  planCapabilityRoute, applyCapabilityRoute, validateCapabilityRoute, NODE_IDS,
} from './capabilityRoutePlan.mjs';
import { DEVICE_REGISTRY } from '../shared/registry.mjs';

loadDotEnv();

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const HOST = arg('host');
const PORT = Number(arg('port', '1880'));
const APPLY = process.argv.includes('--apply');

if (!HOST) {
  console.error('Usage: node node-red-bridge/add-capability-route.mjs --host=<pi> [--port=1880] [--apply]');
  process.exit(1);
}

const client = createAdminClient({ host: HOST, port: PORT, timeoutMs: 20000 });
const auth = await client.login();
const { flows, rev } = await client.getFlows(auth);
console.log(`Read ${flows.length} nodes (rev ${rev}).\n`);

/** The tab that carries the meters' devices — found by where they are, never by name. */
const meterTabs = new Set(
  flows.filter((n) => n?.type === 'tuya-smart-device').map((n) => n.z),
);
const plan = planCapabilityRoute(flows, {
  registry: DEVICE_REGISTRY,
  // Every routed meter's device must be on one tab, or the router cannot reach them all.
  tabId: null,
});

// Resolve the tab from the plan's own targets rather than assuming: the router and the devices
// it wires to must live together, and a split would be a fact worth stopping for.
const routeTabs = new Set(plan.routes.map((id) => flows.find((n) => n.id === id)?.z));
if (routeTabs.size !== 1) {
  console.error(`The routed devices span ${routeTabs.size} tabs (${[...routeTabs].join(', ')}).`);
  console.error('A single router cannot wire across tabs. Nothing was written.');
  process.exit(1);
}
plan.tabId = [...routeTabs][0];
for (const node of plan.nodes) node.z = plan.tabId;

const tabLabel = flows.find((n) => n.id === plan.tabId)?.label ?? plan.tabId;
console.log(`Target tab: ${tabLabel}`);
console.log(`Devices with tuya nodes on ${meterTabs.size} tab(s); this route serves ${Object.keys(plan.targets).length} meter(s):\n`);
const nameOf = (id) => flows.find((n) => n.id === id)?.deviceName ?? id;
for (const [device, t] of Object.entries(plan.targets)) {
  const caps = Object.entries(t.caps).map(([base, c]) => `${base} (dp ${c.dp})`).join(', ');
  console.log(`  ${device.padEnd(16)} -> ${nameOf(t.route).padEnd(14)} ${caps}`);
}
for (const w of plan.warnings) console.log(`  ! ${w}`);

if (!plan.nodes.length) {
  console.log('\nNothing to route — no meter on this flow declares a writable capability.');
  process.exit(0);
}

const next = applyCapabilityRoute(flows, plan);
const problems = validateCapabilityRoute(flows, next, plan);
if (problems.length) {
  console.error('\nRefusing to write — the plan does not hold:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const added = plan.nodes.length;
const existing = flows.filter((n) => Object.values(NODE_IDS).includes(n?.id)).length;
console.log(`\nPlan: add ${added} node(s)${existing ? ` (replacing ${existing} from a previous run)` : ''}.`);
console.log(`      POST /capability/:deviceId  ->  ${plan.routes.length} device(s).`);
console.log(`      Flow size: ${flows.length} -> ${next.length} nodes.`);
console.log('\nInvariants hold: every pre-existing node is byte-identical, and every routing');
console.log('target is a tuya device node that already existed.');

if (!APPLY) {
  console.log('\nDry run only — nothing was written. Re-run with --apply.');
  process.exit(0);
}

await client.postFlows(auth, next, rev);
console.log('\nDeployed. Restart Node-RED, then POST a real write and read the value back off');
console.log('the device — an HTTP 200 means the flow accepted the message, not that a register moved.');
