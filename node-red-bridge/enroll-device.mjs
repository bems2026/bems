#!/usr/bin/env node
/**
 * Enrols a device: registry entry, flow nodes, and the local key fetched from the vendor cloud
 * so nobody has to copy secrets between browser tabs.
 *
 *     node node-red-bridge/enroll-device.mjs --host=<pi> --list
 *     node node-red-bridge/enroll-device.mjs --host=<pi> --vendor-id=<id> --id=co8 \
 *       --class=outlet_dual --name="Outlet 8" [--room=Lab] [--apply]
 *
 * DRY RUN BY DEFAULT.
 *
 * A device is only real once BOTH halves exist — the registry entry every service imports, and
 * the flow nodes that actually poll it. This writes both from one validated decision, because
 * the failure when they disagree is quiet: a device that shows in the app and never reports, or
 * one polled by the flow that nothing displays.
 *
 * The local key never reaches this terminal. It is read from the cloud and written straight
 * into the flow node; only its length is printed.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadDotEnv, createAdminClient } from './nodeRedAdmin.mjs';
import { createTuyaClient, TUYA_HOSTS } from '../server/tuyaCloud.mjs';
import { DEVICE_REGISTRY } from '../shared/registry.mjs';
import { ENROLLED_DEVICES } from '../shared/registry.enrolled.mjs';
import { validateEnrollment, registryEntryFor, ENROLLABLE_CLASSES } from '../shared/enrollment.mjs';
import { planEnrollment, validateEnrollmentPlan } from './enrollPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
loadDotEnv(join(HERE, '..'));
loadDotEnv(join(HERE, '..', 'server'));

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const HOST = arg('host');
const APPLY = process.argv.includes('--apply');
const LIST = process.argv.includes('--list');
const ENROLLED_PATH = join(HERE, '..', 'shared', 'registry.enrolled.mjs');

if (!HOST) {
  console.error('Usage: node node-red-bridge/enroll-device.mjs --host=<pi> --list');
  process.exit(2);
}

const cloudHost = TUYA_HOSTS[(process.env.TUYA_REGION ?? '').toLowerCase()];
if (!process.env.TUYA_ACCESS_ID || !process.env.TUYA_ACCESS_SECRET || !cloudHost) {
  console.error('Tuya cloud is not configured. Set TUYA_ACCESS_ID / TUYA_ACCESS_SECRET / TUYA_REGION in server/.env.');
  process.exit(2);
}

const cloud = createTuyaClient({
  accessId: process.env.TUYA_ACCESS_ID,
  accessSecret: process.env.TUYA_ACCESS_SECRET,
  host: cloudHost,
});
const admin = createAdminClient({ host: HOST, port: Number(arg('port', '1880')), timeoutMs: 20000 });

const devices = await cloud.listDevices();
const auth = await admin.login();
const { flows, rev } = await admin.getFlows(auth);
const claimed = new Set(flows.filter((n) => n.type === 'tuya-smart-device').map((n) => n.deviceId));

if (LIST) {
  const free = devices.filter((d) => !claimed.has(d.id));
  console.log(`${devices.length} device(s) in the cloud project, ${free.length} not yet in the flow:\n`);
  if (!free.length) console.log('  (none — every cloud device already has a node)');
  for (const d of free) {
    const name = String(d.name).slice(0, 22).padEnd(24);
    console.log(`  ${name} ${(d.online ? 'ONLINE' : 'offline').padEnd(8)} --vendor-id=${d.id}`);
  }
  console.log(`\nEnrollable classes: ${ENROLLABLE_CLASSES.join(', ')}`);
  process.exit(0);
}

const draft = {
  deviceId: arg('id'),
  class: arg('class'),
  displayName: arg('name'),
  room: arg('room'),
  tuyaDeviceId: arg('vendor-id'),
  branchCircuit: arg('branch'),
};

const { ok, problems } = validateEnrollment(draft, {
  registry: DEVICE_REGISTRY,
  cloudDeviceIds: devices.map((d) => d.id),
});
if (!ok) {
  console.error('Cannot enrol:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const entry = registryEntryFor(draft);
const chosen = devices.find((d) => d.id === draft.tuyaDeviceId);

// The version the device itself announces, never a default: a wrong one fails as
// `find() timed out`, which reads exactly like a network fault.
const detail = await cloud.describeDevice(draft.tuyaDeviceId);
const tuyaVersion = detail?.version ? String(detail.version) : null;
if (!tuyaVersion) {
  console.error('The cloud did not report a protocol version for that device. Refusing to guess one.');
  process.exit(1);
}
if (!detail?.local_key) {
  console.error('The cloud did not return a local key for that device. Without it the node cannot connect.');
  process.exit(1);
}

// Placed on the tab its peers already live on, so the flow stays navigable by a human.
const peerTab = flows.find((n) => n.type === 'tuya-smart-device' && /^CO\d$/.test(n.deviceName ?? ''))?.z;
const plan = planEnrollment(
  flows,
  entry,
  { tuyaDeviceId: draft.tuyaDeviceId, localKey: detail.local_key, tuyaVersion },
  { z: peerTab ?? flows.find((n) => n.type === 'tab')?.id, x: 200, y: 1600 },
);
if (plan.problems.length) {
  console.error('Cannot generate flow nodes:');
  for (const p of plan.problems) console.error(`  - ${p}`);
  process.exit(1);
}

const tabLabel = flows.find((n) => n.id === plan.added[0].z)?.label ?? '?';
console.log('=== PLAN ===');
console.log(`  vendor device  ${chosen.name} (${draft.tuyaDeviceId.slice(0, 8)}…, ${chosen.online ? 'ONLINE' : 'offline'})`);
console.log(`  protocol       v${tuyaVersion}  (as announced by the device)`);
console.log(`  local key      present, ${detail.local_key.length} chars — not printed`);
console.log(`  registry entry ${entry.id} "${entry.display_name}" class=${entry.class} ctx=${entry.ctx} dps=${entry.dps_map}`);
console.log(`  flow nodes     +2 (device + parser) on tab ${JSON.stringify(tabLabel)}`);
console.log(`\nResulting flow size: ${flows.length} -> ${plan.flows.length} nodes.\n`);

console.log('=== INVARIANTS ===');
const invalid = validateEnrollmentPlan(flows, plan.flows);
if (invalid.length) {
  for (const p of invalid) console.error(`  FAIL  ${p}`);
  console.error('\nABORT: the plan violates an invariant. Nothing was written.');
  process.exit(1);
}
console.log('  OK  exactly 2 nodes added');
console.log('  OK  no existing node modified or removed');
console.log('  OK  the device node reaches a parser');
console.log('  OK  no dangling wires');

if (!APPLY) {
  console.log('\nDry run — nothing written. Re-run with --apply.');
  process.exit(0);
}

// Registry first, deliberately. If the flow write then fails, the app knows about a device that
// does not report yet — visible on the Devices page and recoverable by re-running. The reverse
// order leaves hardware being polled that nothing displays, which is far harder to notice.
const src = readFileSync(ENROLLED_PATH, 'utf8');
const next = JSON.stringify([...ENROLLED_DEVICES, entry], null, 2);
const updated = src.replace(/export const ENROLLED_DEVICES = \[[\s\S]*\];\s*$/, `export const ENROLLED_DEVICES = ${next};\n`);
if (updated === src) {
  console.error('ABORT: could not find the ENROLLED_DEVICES array to update. Nothing was written.');
  process.exit(1);
}
writeFileSync(ENROLLED_PATH, updated);
console.log(`\nWrote ${entry.id} to shared/registry.enrolled.mjs`);

const res = await admin.postFlows(auth, plan.flows, rev);
if (res.status === 409) {
  console.error('ABORT: HTTP 409 — the flow changed between the read and this write.');
  console.error('The registry entry was written; re-run to add the flow nodes.');
  process.exit(1);
}
if (!res.ok) {
  console.error(`ABORT: POST /flows failed — HTTP ${res.status}.`);
  console.error('The registry entry was written; re-run to add the flow nodes.');
  process.exit(1);
}
console.log('Flow nodes deployed.');
console.log('\nStill to do:');
console.log('  1. commit shared/registry.enrolled.mjs');
console.log('  2. npm run build:flow && npm run deploy:pi   (so the bridge tab collects the new device)');
