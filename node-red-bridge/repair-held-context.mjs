#!/usr/bin/env node
/**
 * Corrects Node-RED's own copies of a held reading — the 24 h ring and the legacy integrators (RM-136).
 *
 *     node node-red-bridge/repair-held-context.mjs --device=<id> --from=<iso> --to=<iso>            # dry run
 *     sudo systemctl stop nodered
 *     node node-red-bridge/repair-held-context.mjs --device=<id> --from=<iso> --to=<iso> --apply
 *     sudo systemctl start nodered
 *
 * DRY RUN BY DEFAULT. The plan is `heldContextRepair.mjs`. `--apply` REFUSES while Node-RED is running:
 * flow context is read at start and written back from memory, so an edit made underneath a running
 * Node-RED is overwritten within half a minute (the brief's deterministic order: stop, edit, start). Each
 * file is backed up beside itself first, and read back after writing.
 *
 * The files are found by what they hold, not by tab id: the one carrying `hist_<device>` (the bridge tab)
 * and the one carrying `<ctx>_energy` (the Energy tab).
 */
import { readFileSync, writeFileSync, readdirSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { DEVICE_REGISTRY } from '../shared/registry.mjs';
import { planHeldContextRepair } from './heldContextRepair.mjs';

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const DEVICE = arg('device');
const FROM = arg('from');
const TO = arg('to');
const DIR = arg('dir', join(homedir(), '.node-red', 'context'));
const APPLY = process.argv.includes('--apply');

if (!DEVICE || !FROM || !TO) {
  console.error('Usage: node node-red-bridge/repair-held-context.mjs --device=<id> --from=<iso> --to=<iso> [--dir=<context dir>] [--apply]');
  process.exit(2);
}
const device = DEVICE_REGISTRY.find((d) => d.id === DEVICE);
if (!device?.ctx) { console.error(`${DEVICE}: not a registry device with a flow-context prefix`); process.exit(2); }
const fromMs = Date.parse(FROM), toMs = Date.parse(TO);
if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) { console.error('--from and --to must be instants, --from first'); process.exit(2); }

const ringKey = `hist_${device.id}`;
const energyKey = `${device.ctx}_energy`;
const files = existsSync(DIR) ? readdirSync(DIR).map((d) => join(DIR, d, 'flow.json')).filter((f) => existsSync(f)) : [];
const load = (f) => JSON.parse(readFileSync(f, 'utf8'));
const ringFile = files.find((f) => Array.isArray(load(f)[ringKey]));
const energyFile = files.find((f) => load(f)[energyKey] !== undefined);
if (!ringFile || !energyFile) {
  console.error(`REFUSED — could not find ${!ringFile ? `the ring (${ringKey})` : `the integrator (${energyKey})`} under ${DIR}.`);
  process.exit(1);
}

const ringCtx = load(ringFile);
const energyCtx = load(energyFile);
const plan = planHeldContextRepair({ ring: ringCtx[ringKey], energy: energyCtx, ctx: device.ctx, fromMs, toMs });
console.log(`Held-reading repair in Node-RED's context — ${DEVICE} (${device.ctx})`);
console.log(`window ${new Date(fromMs).toISOString()} .. ${new Date(toMs).toISOString()}\n`);
if (plan.refused) { console.error(`REFUSED — ${plan.refused}. Nothing written.`); process.exit(1); }

console.log('=== PLAN ===');
console.log(`  ring ${ringKey}: ${plan.changed} sample(s) holding ${plan.held.power_w} W / ${plan.held.current} A -> 0 W / 0 A, frozen flag removed`);
console.log(`  phantom the integrators counted: ${plan.phantomKwh.toFixed(4)} kWh (held power over the time they ran)`);
for (const k of plan.integrators) console.log(`  ${k.padEnd(18)} ${Number(energyCtx[k]).toFixed(4)} -> ${plan.energy[k].toFixed(4)}`);

if (!APPLY) {
  console.log('\nDry run — nothing written. Stop Node-RED, re-run with --apply, start Node-RED.');
  process.exit(0);
}

let state;
try {
  state = execFileSync('systemctl', ['is-active', 'nodered'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch (e) {
  state = String(e.stdout ?? '').trim() || 'unknown';
}
if (!['inactive', 'failed'].includes(state)) {
  console.error(`REFUSED — nodered is ${state}. Stop it first (sudo systemctl stop nodered): a running Node-RED overwrites its context files from memory.`);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
for (const f of new Set([ringFile, energyFile])) copyFileSync(f, `${f}.bak-held-${stamp}`);
if (ringFile === energyFile) {
  writeFileSync(ringFile, JSON.stringify({ ...ringCtx, ...plan.energy, [ringKey]: plan.ring }));
} else {
  writeFileSync(ringFile, JSON.stringify({ ...ringCtx, [ringKey]: plan.ring }));
  writeFileSync(energyFile, JSON.stringify(plan.energy));
}

const ringBack = load(ringFile)[ringKey];
const energyBack = load(energyFile);
const heldLeft = ringBack.filter((s) => {
  const t = Date.parse(s.sample_ts ?? s.ts);
  return t >= fromMs && t <= toMs && Number(s.power_w) === plan.held.power_w && Number(s.current) === plan.held.current;
}).length;
const integratorsOk = plan.integrators.every((k) => Math.abs(Number(energyBack[k]) - plan.energy[k]) < 1e-12);
if (heldLeft || !integratorsOk) {
  console.error(`FAIL: read back ${heldLeft} held sample(s) left; integrators ${integratorsOk ? 'ok' : 'differ'}. Backups: *.bak-held-${stamp}`);
  process.exit(1);
}
console.log(`\nWritten and read back. Backups beside each file: flow.json.bak-held-${stamp}`);
console.log('Now: sudo systemctl start nodered');
