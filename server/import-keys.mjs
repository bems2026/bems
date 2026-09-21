#!/usr/bin/env node
/**
 * Loads device ids and local keys from a key tool's export into the Pi's credential store.
 *
 *     npm run keys:import -- <export.json|export.csv>                       # dry run: what would be stored
 *     npm run keys:import -- <export.json|export.csv> --apply               # store it
 *     npm run keys:import -- <export.json|export.csv> --apply --complete    # ...and it lists EVERY device
 *
 * The Pi-side twin of Add Device's "Import keys", for an export that is already on the Pi (copied
 * over with scp, say). Both call `credentialImport.mjs` and `credentialStore.mjs`, so they accept and
 * refuse the same rows. The running proxy re-reads the store on every request: no restart needed.
 *
 * `--complete` says the export lists every device in the account, as the QR-login tool's and
 * `tinytuya wizard`'s do. Only then may a device's absence from it count towards calling a flow node
 * orphaned (see `deviceSources.mjs`).
 *
 * Keys are never printed — only their length. Delete the export file afterwards: the store is the
 * one copy that needs to exist, and it is owner-read-only.
 */

import { readFileSync } from 'node:fs';
import { parseCredentialExport } from './credentialImport.mjs';
import { createCredentialStore, DEFAULT_CREDENTIAL_PATH } from './credentialStore.mjs';

const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
const APPLY = process.argv.includes('--apply');
const COMPLETE = process.argv.includes('--complete');

if (!file) {
  console.error('Usage: npm run keys:import -- <export file> [--apply] [--complete]');
  process.exit(2);
}

let content;
try {
  content = readFileSync(file, 'utf8');
} catch (err) {
  console.error(`[keys] cannot read ${file}: ${err.code ?? err.message}`);
  process.exit(2);
}

const parsed = parseCredentialExport(content);
if (!parsed.format || parsed.devices.length === 0) {
  for (const p of parsed.problems) console.error(`[keys] ${p}`);
  if (parsed.format) console.error('[keys] no row had both a device id and a usable local key');
  process.exit(1);
}

console.log(`[keys] ${parsed.format.toUpperCase()} export, ${parsed.devices.length} device(s) with a key:`);
for (const d of parsed.devices) {
  console.log(`  ${(d.name ?? '(no name)').padEnd(28)} ${(d.category ?? '?').padEnd(12)} ${d.id}  key ${d.localKey.length} chars${d.sub ? '  (sub-device)' : ''}`);
}
for (const p of parsed.problems) console.log(`  skipped   ${p}`);

if (!APPLY) {
  console.log(`\n[keys] Dry run — nothing stored. Pass --apply to write ${DEFAULT_CREDENTIAL_PATH}${COMPLETE ? '' : ' (add --complete if this export lists every device in the account)'}.`);
  process.exit(0);
}

const r = createCredentialStore().importDevices(parsed.devices, { source: `cli:${parsed.format}`, complete: COMPLETE });
console.log(`\n[keys] Stored: added ${r.added}, updated ${r.updated}, ${r.total} device(s) in the store${COMPLETE ? '; recorded as the complete account list' : ''}.`);
console.log('[keys] Delete the export file now — the store is the one copy that needs to exist.');
