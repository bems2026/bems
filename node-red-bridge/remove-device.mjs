#!/usr/bin/env node
/**
 * Removes an enrolled device: its flow nodes, then its registry entry.
 *
 *     node node-red-bridge/remove-device.mjs --host=<pi> --list
 *     node node-red-bridge/remove-device.mjs --host=<pi> --id=co8 [--apply]
 *
 * DRY RUN BY DEFAULT, like every other script that writes to the live flow.
 *
 * Only enrolled devices can be removed. The built-in ones are hand-written in
 * `shared/registry.mjs`, and a script editing hand-written source is exactly what the separate
 * generated module exists to avoid.
 *
 * WHAT SURVIVES: everything the device measured. `readings` is keyed by `device_id`, not by a
 * foreign key into the registry, so removal deletes the device and keeps its history — which is
 * why this is a deletion rather than a `status: 'retired'` flag nothing reads.
 *
 * Every decision lives in `server/removeService.mjs`, which the `POST /api/remove` endpoint
 * also calls, so this and the page cannot disagree about what is allowed.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadDotEnv, createAdminClient } from './nodeRedAdmin.mjs';
import { DEVICE_REGISTRY } from '../shared/registry.mjs';
import { ENROLLED_DEVICES } from '../shared/registry.enrolled.mjs';
import { removeDevice } from '../server/removeService.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
loadDotEnv(join(HERE, '..'));
loadDotEnv(join(HERE, '..', 'server'));

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const HOST = arg('host');
const ID = arg('id');
const APPLY = process.argv.includes('--apply');
const LIST = process.argv.includes('--list');
const ENROLLED_PATH = join(HERE, '..', 'shared', 'registry.enrolled.mjs');

if (!HOST) {
  console.error('Usage: node node-red-bridge/remove-device.mjs --host=<pi> --list');
  console.error('       node node-red-bridge/remove-device.mjs --host=<pi> --id=co8 [--apply]');
  process.exit(2);
}

if (LIST) {
  if (ENROLLED_DEVICES.length === 0) {
    console.log('No enrolled devices. The built-in ones in shared/registry.mjs cannot be removed this way.');
  } else {
    console.log(`${ENROLLED_DEVICES.length} enrolled device(s), removable:\n`);
    for (const d of ENROLLED_DEVICES) console.log(`  ${d.id.padEnd(18)} ${d.class.padEnd(12)} ${d.display_name}`);
  }
  process.exit(0);
}

if (!ID) {
  console.error('Which device? Pass --id=<device id>, or --list to see what is removable.');
  process.exit(2);
}

const result = await removeDevice(
  { deviceId: ID },
  {
    registry: DEVICE_REGISTRY,
    admin: createAdminClient({ host: HOST, port: 1880, timeoutMs: 20000 }),
    readEnrolled: () => {
      const source = readFileSync(ENROLLED_PATH, 'utf8');
      const m = /export const ENROLLED_DEVICES = (\[[\s\S]*\]);/.exec(source);
      let devices;
      try {
        devices = m ? JSON.parse(m[1]) : [];
      } catch {
        devices = [];
      }
      return { source, devices };
    },
    writeEnrolled: (source) => writeFileSync(ENROLLED_PATH, source),
    apply: APPLY,
  },
);

if (!result.ok) {
  console.error(`\nRefused at the ${result.stage} step:`);
  for (const p of result.problems) console.error(`  - ${p}`);
  process.exit(1);
}

const s = result.summary;
console.log(`\n${result.stage === 'applied' ? 'Removed' : 'Would remove'}: ${s.displayName} (${s.deviceId})`);
console.log(`  Flow nodes : ${s.nodesBefore} -> ${s.nodesAfter}`);
console.log(`  Taking out : ${s.removedNodes.join(', ')}`);
console.log('  History    : kept — readings are keyed by device id, so nothing measured is deleted');

if (result.stage === 'applied') {
  console.log('\nCommit shared/registry.enrolled.mjs, then: npm run build:flow && npm run deploy:pi');
} else {
  console.log('\nDry run. Nothing was written. Re-run with --apply to remove it.');
}
