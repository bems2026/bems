#!/usr/bin/env node
/**
 * Points an orphaned flow node at the device that replaced it after a re-pair in Smart Life.
 *
 *     npm run rebind:pi -- --node="NBRIC IR Blaster" --vendor=<vendor device id>            # dry run
 *     npm run rebind:pi -- --node="NBRIC IR Blaster" --vendor=<vendor device id> --apply    # write
 *
 * The same service the Devices page's Rebind calls (`server/rebindService.mjs`), so the two cannot
 * disagree about what they refuse. Run it ON THE PI: the protocol version is heard from the device's
 * own LAN broadcast, which exists only on the device segment, and Node-RED listens on loopback.
 *
 * The local key is fetched from the vendor cloud and written into the flow; it is never printed —
 * only its length. Take a backup of ~/.node-red/flows.json first, as for every flow write.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDotEnv } from './nodeRedAdmin.mjs';
import { TUYA_HOSTS } from '../server/tuyaCloud.mjs';
import { rebindDevice } from '../server/rebindService.mjs';
import { realRebindDeps } from '../server/rebindRoute.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
loadDotEnv(join(HERE, '..'));
loadDotEnv(join(HERE, '..', 'server'));

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const NODE = arg('node');
const VENDOR = arg('vendor');
const APPLY = process.argv.includes('--apply');
const HOST = arg('host', '127.0.0.1');
const PORT = Number(arg('port', '1880'));

if (!NODE || !VENDOR) {
  console.error('Usage: npm run rebind:pi -- --node="<flow node name>" --vendor=<vendor device id> [--apply]');
  process.exit(2);
}
const host = TUYA_HOSTS[(process.env.TUYA_REGION ?? '').toLowerCase()];
if (!process.env.TUYA_ACCESS_ID || !process.env.TUYA_ACCESS_SECRET || !host) {
  console.error('The vendor cloud is not configured (TUYA_ACCESS_ID / TUYA_ACCESS_SECRET / TUYA_REGION in server/.env).');
  process.exit(2);
}

console.log(`[rebind] ${APPLY ? 'Applying' : 'Dry run (pass --apply to write)'}: "${NODE}"`);
console.log('[rebind] listening for the device\'s announcement may take up to 12 s...\n');

const r = await rebindDevice(
  { nodeName: NODE, tuyaDeviceId: VENDOR },
  realRebindDeps({ accessId: process.env.TUYA_ACCESS_ID, accessSecret: process.env.TUYA_ACCESS_SECRET, host, apply: APPLY, adminHost: HOST, adminPort: PORT }),
);

if (!r.ok) {
  console.error(`[rebind] Refused at the ${r.stage} step:`);
  for (const p of r.problems) console.error(`  - ${p}`);
  process.exit(1);
}
const s = r.summary;
console.log(`  node           ${s.nodeName}`);
console.log(`  new device     ${s.vendorName} (${s.kind}) ${s.vendorOnline ? 'online' : 'offline'}`);
console.log(`  protocol       v${s.tuyaVersion} as announced${s.declaredVersion ? ` (declared v${s.declaredVersion})` : ''}`);
console.log(`  local key      present, ${s.localKeyLength} chars`);
console.log(`  fields         ${s.fieldsChanged.join(', ') || 'none'}`);
for (const n of s.notes) console.log(`  note           ${n}`);
console.log(r.stage === 'applied' ? '\n[rebind] Written.' : '\n[rebind] Dry run only — nothing was written.');
