#!/usr/bin/env node
/**
 * Says whether the devices are actually being reached over the local network right now.
 *
 *     node node-red-bridge/local-probe.mjs --host=<pi>
 *
 * READ-ONLY. It reads the live flow and the bridge's readings endpoint and writes nothing,
 * anywhere — no flow write, no command, no relay. It is safe to run at any time, including on a
 * building somebody is working in.
 *
 * WHY IT EXISTS. "Can these devices be controlled over the 2.4 GHz LAN from their device id and
 * local key, with no vendor cloud in the path?" is the question this system gets asked most, and
 * the answer has been yes since the first release: the fleet sits on the Pi's own segment, and
 * `server/dispatchLight.mjs` tries that path first on every single command. But nothing produced
 * that answer on demand. `npm run tuya:devices` compares the vendor cloud's opinion against the
 * bridge's — useful, and a different question: it never touches the local protocol, so it cannot
 * tell "the LAN path is working" from "the cloud says the device is up".
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not open its own `tuyapi` session. A Tuya device has
 * a small fixed inbound socket table, and exhausting it is the exact failure that leaves a device
 * unreachable locally while its cloud connection stays healthy — see
 * `docs/adr-002-device-recovery-path.md`. A diagnostic that can cause the fault it is looking for
 * is not a diagnostic. This observes the sessions Node-RED already holds.
 *
 * The reasoning is in `localProbePlan.mjs`; this file is the I/O.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDotEnv, createAdminClient } from './nodeRedAdmin.mjs';
import { planLocalProbe, LOCAL_SILENT_MS } from './localProbePlan.mjs';
import { DEVICE_REGISTRY } from '../shared/registry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
loadDotEnv(join(HERE, '..'));

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const HOST = arg('host');
const PORT = Number(arg('port', '1880'));
const JSON_OUT = process.argv.includes('--json');

if (!HOST) {
  console.error('Usage: node node-red-bridge/local-probe.mjs --host=<pi> [--port=1880] [--json]');
  process.exit(2);
}

const client = createAdminClient({ host: HOST, port: PORT, timeoutMs: 20000 });

const auth = await client.login();
const { flows } = await client.getFlows(auth);

// The bridge's own endpoint, not the proxy: this is a diagnostic run on the Pi, and going
// through the authenticated proxy would make an unrelated failure (an expired session, Supabase
// being down) look like a device problem — which is the confusion this script exists to end.
let readings = [];
try {
  const res = await fetch(`http://${HOST}:${PORT}/api/readings/latest`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  readings = await res.json();
} catch (err) {
  console.error(`Could not read the bridge readings endpoint: ${err.message}`);
  console.error('The node table below is still accurate; the device table cannot be produced.');
}

const report = planLocalProbe({ flows, readings, registry: DEVICE_REGISTRY, nowMs: Date.now() });

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.summary.down > 0 ? 1 : 0);
}

const secs = (ms) => (ms === null ? '     —' : `${Math.round(ms / 1000)}`.padStart(5) + 's');

console.log('LOCAL DEVICE SESSIONS — observed, nothing sent\n');
console.log('  device                class                 last report   verdict');
for (const d of report.devices) {
  console.log(`  ${d.deviceId.padEnd(21)} ${d.class.padEnd(21)} ${secs(d.lastReportMs)}   ${d.local}`);
}

console.log('\nFLOW-DECLARED SESSION SETTINGS');
console.log('  node                  protocol  findTimeout  notes');
for (const n of report.nodes) {
  const notes = [n.quiesced ? 'quiesced' : null, n.staticAddress ? 'static address' : null].filter(Boolean).join(', ');
  console.log(`  ${String(n.node).padEnd(21)} ${String(n.protocol ?? '?').padEnd(9)} ${String(n.findTimeoutMs ?? '?').padEnd(12)} ${notes}`);
}

const s = report.summary;
// The headline is live + live-unmeasured, because both are healthy on the local network and
// quoting only the confirmed half reads as a fleet in trouble when it is not. The split is on
// the next line, because "confirmed by a recent report" and "healthy but unmeasurable" are
// genuinely different strengths of evidence and collapsing them would be the fabrication this
// probe exists to avoid.
const healthy = s.live + s.liveUnmeasured;
console.log(`\n${healthy}/${s.devices} devices healthy on the local network.`);
if (s.liveUnmeasured) {
  console.log(`  ${s.live} confirmed by a report arriving within ${LOCAL_SILENT_MS / 1000}s over the local protocol.`);
  console.log(`  ${s.liveUnmeasured} carry no arrival stamp of their own (switches, the ACU, the outdoor probe) — the`);
  console.log('  bridge synthesizes their timestamp, so their age is not evidence either way and their');
  console.log('  health comes from a real connection signal instead.');
}
if (s.silent) console.log(`  ${s.silent} present but silent — reachable as far as the flow knows, not reporting.`);
if (s.down) console.log(`  ${s.down} down. Restart Node-RED before suspecting hardware — see docs/pi-session-brief.md.`);
if (s.unknown) console.log(`  ${s.unknown} unknown — absent from the feed, which is a registry/flow mismatch rather than a device fault.`);
if (s.quiescedNodes.length) console.log(`  quiesced on purpose: ${s.quiescedNodes.join(', ')} (reversible with quiesce:pi --undo)`);
console.log(`  protocol versions in use: ${s.protocols.join(', ') || 'none declared'}`);
console.log('\nNo vendor cloud was contacted, and nothing was sent to any device.');

process.exit(s.down > 0 ? 1 : 0);
