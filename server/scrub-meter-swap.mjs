#!/usr/bin/env node
/**
 * Corrects the stored rows the shared dual-channel meter wrote while the device had its channels
 * traded (RM-123).
 *
 *     node server/scrub-meter-swap.mjs [--from=2026-09-19T00:00:00+08:00] [--to=<iso>]   # dry run
 *     node server/scrub-meter-swap.mjs ... --apply                                          # write it
 *
 * DRY RUN BY DEFAULT. Prints the swapped windows with their evidence, the affected local days, the
 * energy each device would end those days with, and the `enacc_*` deltas the bridge's own
 * week/month bases banked from the wrong figures. Writes nothing without --apply.
 *
 * The plan is `scrubMeterSwap.mjs`, a pure function over the two devices' rows, so the dry run and
 * the apply compute the same thing; its classifier is the live demux's (`shared/channelDemux.mjs`).
 * Reads are paged and never trust a full page (PostgREST caps silently — phase9). The apply is a bulk
 * upsert on the primary key, then EVERY affected row is read back and compared to the plan: a
 * `return=minimal` 201 says nothing about what landed.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDotEnv } from '../node-red-bridge/nodeRedAdmin.mjs';
import { makeSupabaseClient } from './supabaseRest.mjs';
import { BUILT_IN_DEVICES, SITE } from '../shared/registry.mjs';
import { CAPABILITY_PROFILES } from '../shared/deviceCapabilities.mjs';
import { planScrub, localDayOf, SCRUB_COLUMNS } from './scrubMeterSwap.mjs';
import { iso8 } from '../shared/buildLatest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
loadDotEnv(join(HERE, '..'));
loadDotEnv(HERE);

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const FROM = new Date(arg('from', '2026-09-19T00:00:00+08:00')).toISOString();
const TO = new Date(arg('to', new Date().toISOString())).toISOString();
const APPLY = process.argv.includes('--apply');
const PAGE = 1000;
const BATCH = 500;
const OFFSET = SITE.utc_offset_minutes;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in server/.env');
  process.exit(2);
}
const client = makeSupabaseClient({ url, serviceRoleKey: key, timeoutMs: 30000 });

const pair = SITE.channel_demux?.[0];
if (!pair) { console.error('SITE.channel_demux declares no pair; nothing to scrub.'); process.exit(2); }
const [coId, loId] = pair.devices;
const profile = CAPABILITY_PROFILES[BUILT_IN_DEVICES.find((d) => d.id === coId).capability_profile];
const SELECT = 'device_id,ts,voltage,current,power_w,energy_kwh_today,online,total_energy_kwh,warn_power_w,power_type,capabilities';

const local = (iso) => iso8(Date.parse(iso), OFFSET).slice(0, 16).replace('T', ' ');

/** Every row of one device in the window, in time order. Paged by offset; a short page ends it. */
async function readAll(deviceId) {
  const out = [];
  for (let page = 0; ; page++) {
    const batch = await client.select('readings',
      `select=${SELECT}&device_id=eq.${deviceId}&ts=gte.${encodeURIComponent(FROM)}&ts=lt.${encodeURIComponent(TO)}&order=ts.asc&limit=${PAGE}&offset=${page * PAGE}`);
    out.push(...batch);
    if (batch.length < PAGE) return out;
    if (page > 400) throw new Error('paging runaway');
  }
}

console.log(`Shared dual-channel meter scrub — ${coId} (channel 1) / ${loId} (channel 2)`);
console.log(`window ${local(FROM)} .. ${local(TO)} (site time) · rules: above ${pair.ceiling_w} W is ${pair.never_idle}; idle is the other\n`);

const [co, lo] = await Promise.all([readAll(coId), readAll(loId)]);
console.log(`read ${co.length} + ${lo.length} rows`);
const at = new Date().toISOString();
const plan = planScrub({ co, lo, profile, rules: { ceiling_w: pair.ceiling_w }, offsetMinutes: OFFSET, at });
console.log(`paired ${plan.pairs} minutes\n`);

if (!plan.windows.length) {
  console.log('No swapped minute in this window. Nothing to do.');
  process.exit(0);
}

console.log('=== SWAPPED WINDOWS (after the two-sample debounce) ===');
let swappedMin = 0;
for (const w of plan.windows) {
  const toLabel = w.to ? local(w.to) : 'still swapped at the end of the window';
  console.log(`  ${local(w.from)} -> ${toLabel}   ${w.samples} min   established by the ${w.rule} rule`);
  swappedMin += w.samples;
}
console.log(`  total ${(swappedMin / 60).toFixed(1)} h swapped\n`);

console.log('=== AFFECTED LOCAL DAYS — energy as stored vs as it would be restated (kWh) ===');
// The day's HIGHEST counter, which is what a report sums (phase42) — the last row of a local day
// can already carry the bridge's midnight reset, measured 2026-09-19 23:59:27.
const dayMax = (rows, dev, day) => Math.max(...rows
  .filter((r) => r.device_id === dev && localDayOf(r.ts, OFFSET) === day && r.energy_kwh_today !== null)
  .map((r) => Number(r.energy_kwh_today)), 0);
// Which completed days the bridge has folded into which base: a day folds into the week and the
// month it ENDED in (energyAccumulator.mjs, fault 2). Weeks start Monday, as the reports' do.
const today = localDayOf(new Date().toISOString(), OFFSET);
const mondayOf = (day) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const deltas = { week: { [coId]: 0, [loId]: 0 }, month: { [coId]: 0, [loId]: 0 } };
for (const day of plan.affectedDays) {
  for (const [dev, rows] of [[coId, co], [loId, lo]]) {
    const stored = dayMax(rows, dev, day);
    const restated = dayMax(plan.updates, dev, day);
    const delta = restated - stored;
    const ended = day < today;
    if (ended && day.slice(0, 7) === today.slice(0, 7)) deltas.month[dev] += delta;
    if (ended && mondayOf(day) === mondayOf(today)) deltas.week[dev] += delta;
    console.log(`  ${day}  ${dev.padEnd(15)} stored ${stored.toFixed(3).padStart(8)}  ->  restated ${restated.toFixed(3).padStart(8)}   (${delta >= 0 ? '+' : ''}${delta.toFixed(3)})${ended ? '' : '   (in progress — not folded yet)'}`);
  }
}
console.log(`\n  ${plan.updates.length} rows would be rewritten (${plan.updates.filter((u) => u.capabilities?.scrub?.swapped).length} traded, the rest energy-only).`);

console.log('\n=== BRIDGE CONTEXT (enacc_*) — what the flow banked from the stored figures ===');
console.log('  The bridge folds each completed day\'s energy_kwh_today into weekBase/monthBase at local');
console.log('  midnight. For days already folded, the flow\'s bases carry the stored (wrong) figure; the');
console.log('  correction below is the sum of the restatements over the affected days that have ended.');
console.log('  Apply it by hand per docs/pi-session-brief.md: stop Node-RED, edit enacc_<device> in');
console.log('  ~/.node-red/context/<bridge tab>/flow.json, start Node-RED. (A day still in progress is');
console.log('  re-anchored by the bridge itself and needs no correction.)');
for (const dev of [coId, loId]) {
  const w = deltas.week[dev], m = deltas.month[dev];
  console.log(`  ${dev.padEnd(15)} weekBase ${w >= 0 ? '+' : ''}${w.toFixed(3)} kWh   monthBase ${m >= 0 ? '+' : ''}${m.toFixed(3)} kWh`);
}

if (!APPLY) {
  console.log('\nDry run — nothing written. Re-run with --apply to rewrite the rows above.');
  console.log('If the affected week\'s period_reports row already exists, regenerate it afterwards:');
  console.log("  select * from generate_period_report('week', '<monday>');");
  process.exit(0);
}

console.log(`\nApplying — ${plan.updates.length} rows in batches of ${BATCH}…`);
for (let i = 0; i < plan.updates.length; i += BATCH) {
  await client.upsert('readings', plan.updates.slice(i, i + BATCH), { onConflict: 'device_id,ts' });
  process.stdout.write(`  ${Math.min(i + BATCH, plan.updates.length)}/${plan.updates.length}\r`);
}
console.log('\nWritten. Reading back every affected row…');

const [co2, lo2] = await Promise.all([readAll(coId), readAll(loId)]);
const after = new Map([...co2, ...lo2].map((r) => [`${r.device_id}|${r.ts}`, r]));
/** jsonb stores keys in its own order, so a stored object is compared by content, never by its text. */
const canonical = (v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}'
  : JSON.stringify(v));
let mismatches = 0;
for (const u of plan.updates) {
  const r = after.get(`${u.device_id}|${u.ts}`);
  if (!r) { mismatches++; continue; }
  for (const col of SCRUB_COLUMNS) {
    if (col === 'device_id' || col === 'ts') continue;
    if (col === 'online') { if (!!r.online !== !!u.online) { mismatches++; break; } continue; }
    if (col === 'capabilities' || col === 'power_type') {
      if (canonical(r[col]) !== canonical(u[col])) { mismatches++; break; }
      continue;
    }
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
