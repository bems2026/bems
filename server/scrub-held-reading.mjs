#!/usr/bin/env node
/**
 * Corrects stored rows that carry a HELD reading — the bridge's last figure for a channel whose change
 * was never pushed and never re-read (RM-134).
 *
 *     node server/scrub-held-reading.mjs --device=<id> --from=<ts of the last genuine row> --to=<ts of the first re-read row>
 *     node server/scrub-held-reading.mjs ... --apply
 *
 * DRY RUN BY DEFAULT. `--from` and `--to` are the exact `ts` of two stored rows, the evidence at each
 * end: the last report the device really made, and the first reading after the meter poll re-read it.
 * The rows strictly between them are the window. The plan is `scrubHeldReading.mjs`, which refuses
 * unless every row in the window repeats the held reading, the device read 0 W / 0 A on re-read, and
 * its own register moved so little across the window that the average power is under a watt. The
 * sibling channel of a dual meter (`SITE.channel_demux`) supplies the voltage; `--sibling=` overrides.
 *
 * The apply is a bulk upsert on the primary key, then EVERY affected row is read back and compared
 * to the plan: a `return=minimal` 201 says nothing about what landed.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDotEnv } from '../node-red-bridge/nodeRedAdmin.mjs';
import { makeSupabaseClient } from './supabaseRest.mjs';
import { DEVICE_REGISTRY, SITE } from '../shared/registry.mjs';
import { channelCodesFor } from '../shared/deviceCapabilities.mjs';
import { planHeldScrub, HELD_COLUMNS } from './scrubHeldReading.mjs';
import { iso8 } from '../shared/buildLatest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
loadDotEnv(join(HERE, '..'));
loadDotEnv(HERE);

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const DEVICE = arg('device');
const FROM = arg('from');
const TO = arg('to');
const APPLY = process.argv.includes('--apply');
const BATCH = 500;
const PAGE = 1000;

if (!DEVICE || !FROM || !TO) {
  console.error('Usage: node server/scrub-held-reading.mjs --device=<id> --from=<ts> --to=<ts> [--sibling=<id>] [--apply]');
  process.exit(2);
}
const device = DEVICE_REGISTRY.find((d) => d.id === DEVICE);
if (!device?.capability_profile) { console.error(`${DEVICE}: not a registry device with a capability profile`); process.exit(2); }
const pair = (SITE.channel_demux ?? []).find((p) => p.devices.includes(DEVICE));
const SIBLING = arg('sibling', pair ? pair.devices.find((id) => id !== DEVICE) : null);

const byBase = channelCodesFor(device.capability_profile, device.channel ?? 1);
const codes = { power: byBase.cur_power, current: byBase.cur_current, voltage: byBase.cur_voltage, state: byBase.device_state, register: byBase.today_acc_energy };
if (Object.values(codes).some((c) => !c)) { console.error(`${DEVICE}: its profile lacks one of ${JSON.stringify(codes)}`); process.exit(2); }

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in server/.env'); process.exit(2); }
const client = makeSupabaseClient({ url, serviceRoleKey: key, timeoutMs: 30000 });

const SELECT = 'device_id,ts,voltage,current,power_w,energy_kwh_today,online,capabilities';
const fromIso = new Date(FROM).toISOString();
const toIso = new Date(TO).toISOString();
const local = (iso) => iso8(Date.parse(iso), SITE.utc_offset_minutes).slice(0, 19).replace('T', ' ');

async function rowAt(id, iso) {
  const got = await client.select('readings', `select=${SELECT}&device_id=eq.${id}&ts=eq.${encodeURIComponent(iso)}`);
  return got[0] ?? null;
}
async function between(id, select = SELECT) {
  const out = [];
  for (let page = 0; ; page++) {
    const batch = await client.select('readings',
      `select=${select}&device_id=eq.${id}&ts=gt.${encodeURIComponent(fromIso)}&ts=lt.${encodeURIComponent(toIso)}&order=ts.asc&limit=${PAGE}&offset=${page * PAGE}`);
    out.push(...batch);
    if (batch.length < PAGE) return out;
    if (page > 100) throw new Error('paging runaway');
  }
}

console.log(`Held-reading scrub — ${DEVICE} (${codes.power}), voltage from ${SIBLING ?? 'nothing'}`);
console.log(`window ${local(fromIso)} .. ${local(toIso)} (site time, both ends exclusive)\n`);

const [start, fresh, rows, siblings] = await Promise.all([
  rowAt(DEVICE, fromIso),
  rowAt(DEVICE, toIso),
  between(DEVICE),
  SIBLING ? between(SIBLING, 'device_id,ts,voltage,online') : Promise.resolve([]),
]);
if (!start || !fresh) {
  console.error(`REFUSED — no stored row at exactly ${!start ? '--from' : '--to'}; both ends must be real rows.`);
  process.exit(1);
}
console.log(`start  ${local(start.ts)}  ${start.power_w} W / ${start.current} A  register ${start.capabilities?.[codes.register]}`);
console.log(`fresh  ${local(fresh.ts)}  ${fresh.power_w} W / ${fresh.current} A  register ${fresh.capabilities?.[codes.register]}  ${fresh.capabilities?.[codes.state] ?? ''}`);
console.log(`${rows.length} row(s) in the window; ${siblings.length} sibling row(s)\n`);

const plan = planHeldScrub({ start, rows, fresh, siblings, codes, siblingId: SIBLING, at: new Date().toISOString() });
if (plan.refused) {
  console.error(`REFUSED — ${plan.refused}. Nothing written.`);
  process.exit(1);
}
const e = plan.evidence;
const noV = plan.updates.filter((u) => u.voltage === null).length;
console.log('=== EVIDENCE ===');
console.log(`  ${e.register_code} ${e.from.value} -> ${e.to.value}: ${e.delta_kwh} kWh across the window, so at most ${e.bound_w} W on average`);
console.log(`  held ${start.power_w} W would have added ${((Number(start.power_w) * (Date.parse(fresh.ts) - Date.parse(start.ts))) / 3.6e9).toFixed(3)} kWh`);
console.log('\n=== PLAN ===');
console.log(`  ${plan.updates.length} row(s): power and current -> 0, voltage from ${SIBLING ?? 'nothing'} (${noV} without a sibling reading -> null),`);
console.log(`  ${codes.state} -> ${fresh.capabilities?.[codes.state] ?? '(unchanged)'}, freeze flag removed, capabilities.scrub stamped. energy_kwh_today untouched.`);

if (!APPLY) {
  console.log('\nDry run — nothing written. Re-run with --apply to rewrite the rows above.');
  process.exit(0);
}

console.log(`\nApplying — ${plan.updates.length} rows in batches of ${BATCH}…`);
for (let i = 0; i < plan.updates.length; i += BATCH) {
  await client.upsert('readings', plan.updates.slice(i, i + BATCH), { onConflict: 'device_id,ts' });
}
console.log('Written. Reading back every affected row…');

const after = new Map((await between(DEVICE)).map((r) => [r.ts, r]));
/** jsonb stores keys in its own order, so a stored object is compared by content, never by its text. */
const canonical = (v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}'
  : JSON.stringify(v));
let mismatches = 0;
for (const u of plan.updates) {
  const r = [...after.values()].find((x) => Date.parse(x.ts) === Date.parse(u.ts));
  if (!r) { mismatches++; continue; }
  for (const col of HELD_COLUMNS) {
    if (col === 'device_id' || col === 'ts') continue;
    if (col === 'online') { if (!!r.online !== !!u.online) { mismatches++; break; } continue; }
    if (col === 'capabilities') { if (canonical(r[col]) !== canonical(u[col])) { mismatches++; break; } continue; }
    const a = r[col] === null ? null : Number(r[col]);
    const b = u[col] === null ? null : Number(u[col]);
    if (a === null || b === null ? a !== b : Math.abs(a - b) > 1e-6) { mismatches++; break; }
  }
}
if (mismatches) {
  console.error(`FAIL: ${mismatches} of ${plan.updates.length} rows do not read back as planned.`);
  process.exit(1);
}
console.log(`OK: all ${plan.updates.length} rows read back as planned.`);
