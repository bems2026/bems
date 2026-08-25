#!/usr/bin/env node
/**
 * Stops a dead `tuya-smart-device` node from retrying `findDevice()` forever.
 *
 *     node node-red-bridge/quiesce-dead-nodes.mjs --host=<pi>            # dry run
 *     node node-red-bridge/quiesce-dead-nodes.mjs --host=<pi> --apply    # actually write
 *     node node-red-bridge/quiesce-dead-nodes.mjs --host=<pi> --name="Outside Temp" --apply
 *     node node-red-bridge/quiesce-dead-nodes.mjs --host=<pi> --undo --apply
 *
 * DRY RUN BY DEFAULT, like every other script that writes to the live flow.
 *
 * WHY: `NBRIC IR Blaster` and `Outside Temp` are not in the Tuya cloud project and have never
 * connected (RM-016). Each retries every ~10 s in perpetuity, filling the Node-RED log with
 * `find() timed out` and holding a discovery listen slot open for hardware that will never
 * answer. Their registry entries stay deliberately — the chosen resolution is "leave them" —
 * so this stops them trying rather than removing them.
 *
 * REVERSIBLE. `--undo` clears the flag, which is what you want the moment either device is
 * re-paired into the cloud project; nothing else has to be put back.
 *
 * THIS WRITES TO THE HAND-BUILT SOURCE TABS. `build-flow.mjs` does not generate them and
 * nothing in the repo can restore them, so back up `~/.node-red/flows.json` first. The plan is
 * checked by `validateQuiescePlan` to change exactly one boolean on exactly the named nodes —
 * `findTimeout` and `tuyaVersion` live only here.
 */

import { loadDotEnv, createAdminClient } from './nodeRedAdmin.mjs';
import { planQuiesce, validateQuiescePlan } from './quiescePlan.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
const UNDO = process.argv.includes('--undo');

/** The two devices RM-016 identified as permanently unreachable. */
const DEFAULT_NAMES = ['NBRIC IR Blaster', 'Outside Temp'];
const NAMES = process.argv.filter((a) => a.startsWith('--name=')).map((a) => a.slice(7));
const TARGETS = NAMES.length ? NAMES : DEFAULT_NAMES;

console.log(`${APPLY ? 'Applying' : 'Dry run (pass --apply to actually write)'} to http://${HOST}:${PORT}`);
console.log(`${UNDO ? 'Re-enabling' : 'Quiescing'}: ${TARGETS.join(', ')}\n`);

const admin = createAdminClient({ host: HOST, port: PORT, timeoutMs: 20000 });
const auth = await admin.login();
const { flows, rev } = await admin.getFlows(auth);
console.log(`Read ${flows.length} existing nodes.\n`);

let next;
let changed;
if (UNDO) {
  // Symmetric and just as narrow: clear the flag, touch nothing else.
  changed = [];
  next = flows.map((n) => {
    if (n.type !== 'tuya-smart-device' || !TARGETS.includes(n.deviceName) || n.disableAutoStart !== true) return n;
    const updated = { ...n, disableAutoStart: false };
    changed.push(updated);
    return updated;
  });
  const missing = TARGETS.filter((t) => !flows.some((n) => n.type === 'tuya-smart-device' && n.deviceName === t));
  if (missing.length) {
    console.error(`No such node(s): ${missing.join(', ')}`);
    process.exit(1);
  }
} else {
  const plan = planQuiesce(flows, TARGETS);
  if (plan.problems.length) {
    console.error('Refused:');
    for (const p of plan.problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  next = plan.flows;
  changed = plan.changed;
}

// The undo path is checked by the same invariants read in reverse — after/before swapped — so
// re-enabling cannot quietly change anything else either.
const invalid = UNDO ? validateQuiescePlan(next, flows, TARGETS) : validateQuiescePlan(flows, next, TARGETS);
if (invalid.length) {
  console.error('Refused by the invariants:');
  for (const p of invalid) console.error(`  - ${p}`);
  process.exit(1);
}

if (changed.length === 0) {
  console.log(`Nothing to do — already ${UNDO ? 'enabled' : 'quiet'}.`);
  process.exit(0);
}

for (const n of changed) console.log(`  ${UNDO ? 'enable ' : 'disable'}  ${n.deviceName}`);
console.log(`\nNode count: ${flows.length} -> ${next.length} (must be unchanged).`);

if (!APPLY) {
  console.log('\nDry run only — nothing was written. Re-run with --apply.');
  process.exit(0);
}

const res = await admin.postFlows(auth, next, rev);
if (!res.ok) {
  console.error(`\nNode-RED refused the write (HTTP ${res.status}). Nothing changed.`);
  process.exit(1);
}
console.log(`\nWritten. ${UNDO ? 'Those nodes will reconnect' : 'Those nodes will stop retrying'} on the next deploy cycle.`);
console.log('Confirm with: sudo journalctl -u nodered --since "-2 min" | grep "find() timed out"');
