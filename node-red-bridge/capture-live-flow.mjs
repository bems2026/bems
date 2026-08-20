#!/usr/bin/env node
/**
 * Captures the live Node-RED flow as a versioned baseline.
 *
 *     node node-red-bridge/capture-live-flow.mjs --host=<pi-address>
 *
 * Why this exists: only the 25-node generated "iBEMS Bridge" tab was ever in version control.
 * The other ~400 nodes — the Outlet, Switch, Aircon and Energy Monitoring tabs that carry the
 * actual control logic — existed solely on the Pi, with no baseline, no diff, and no way to
 * tell what an edit changed. That is the single biggest risk in touching this flow, so it is
 * fixed before anything is removed.
 *
 * READ-ONLY against the live system. It never POSTs a flow; `deploy.mjs` and the two fix
 * scripts remain the only things in this repo allowed to write one.
 *
 * The written file is REDACTED (see redactFlow.mjs) because this repo is public and the flow
 * carries real Tuya device keys. It is therefore a structural baseline for review and diffing,
 * **not a restorable backup** — take a full backup on the Pi itself for that.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { loadDotEnv, createAdminClient } from './nodeRedAdmin.mjs';
import { redactFlow, findResidualSecrets } from './redactFlow.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
loadDotEnv(join(HERE, '..'));

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const HOST = arg('host', '127.0.0.1');
const PORT = Number(arg('port', '1880'));
const OUT = join(HERE, 'live-flow-baseline.json');

// Credential-shaped literals inside function/template bodies, which findResidualSecrets
// deliberately skips (they are long free text and would otherwise produce constant noise).
const CODE_PATTERNS = [/token\s*=\s*['"][^'"]{8,}/i, /password\s*=\s*['"][^'"]{4,}/i, /api[_-]?key\s*=\s*['"][^'"]{8,}/i, /secret\s*=\s*['"][^'"]{6,}/i];

async function main() {
  const client = createAdminClient({ host: HOST, port: PORT, timeoutMs: 20000 });
  const auth = await client.login();
  const { flows, rev } = await client.getFlows(auth);
  console.log(`[capture] read ${flows.length} nodes from ${HOST}:${PORT} (rev ${String(rev).slice(0, 8)}…)`);

  const redacted = redactFlow(flows);

  const residual = findResidualSecrets(redacted);
  const inCode = [];
  for (const n of redacted) {
    for (const field of ['func', 'template', 'initialize', 'finalize']) {
      const v = n[field];
      if (typeof v === 'string' && CODE_PATTERNS.some((p) => p.test(v))) inCode.push(`${n.type}#${n.id} .${field}`);
    }
  }

  // Refuse rather than warn. A warning that scrolls past is how a key ends up in a public
  // repo; there is no safe partial success here.
  if (residual.length || inCode.length) {
    console.error('[capture] REFUSING TO WRITE — possible secrets survived redaction:');
    for (const r of [...residual, ...inCode]) console.error(`  - ${r}`);
    console.error('\nAdd the field to SECRET_FIELDS in redactFlow.mjs, or handle it explicitly, then re-run.');
    process.exit(1);
  }

  const tabs = redacted.filter((n) => n.type === 'tab');
  const counts = {};
  for (const n of redacted) counts[n.z] = (counts[n.z] || 0) + 1;

  writeFileSync(OUT, `${JSON.stringify(redacted, null, 2)}\n`, 'utf8');
  console.log(`[capture] wrote ${OUT}`);
  console.log('[capture] tabs captured:');
  for (const t of tabs) console.log(`  ${String(counts[t.id] || 0).padStart(4)} nodes  ${t.label}`);
  console.log('\n[capture] NOTE: redacted — structural baseline only, not a restorable backup.');
}

main().catch((err) => {
  console.error(`[capture] ${err.message}`);
  process.exit(1);
});
