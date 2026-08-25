#!/usr/bin/env node
/**
 * Reports whether the shared dual-channel meter has traded its two channels.
 *
 *     node server/check-meter-swap.mjs [--hours=24]
 *
 * READ-ONLY. Reports; corrects nothing. See shared/channelSwap.mjs for why correcting would
 * mean guessing which assignment is the true one.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDotEnv } from '../node-red-bridge/nodeRedAdmin.mjs';
import { findChannelSwaps } from '../shared/channelSwap.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
loadDotEnv(join(HERE, '..'));
loadDotEnv(HERE);

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const HOURS = Number(arg('hours', '24'));
const PAGE = 1000;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in server/.env');
  process.exit(2);
}

const since = new Date(Date.now() - HOURS * 3600_000).toISOString();

/** Paged, because a full page is what a silent cap also looks like — see demand-profile.mjs. */
async function readingsFor(deviceId) {
  const out = [];
  for (let page = 0; ; page++) {
    const from = page * PAGE;
    const res = await fetch(
      `${url}/rest/v1/readings?select=ts,power_w&device_id=eq.${deviceId}&online=eq.true&ts=gte.${since}&order=ts.asc`,
      { headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + PAGE - 1}` } },
    );
    const batch = await res.json();
    if (!Array.isArray(batch)) {
      console.error(`Fetch failed for ${deviceId}: ${JSON.stringify(batch).slice(0, 120)}`);
      process.exit(1);
    }
    out.push(...batch);
    if (batch.length < PAGE) return out;
    if (page > 200) { console.error('Range loop runaway.'); process.exit(1); }
  }
}

const [co, lo] = await Promise.all([readingsFor('mtr_co_yellow'), readingsFor('mtr_lo_yellow')]);
const byTs = new Map(lo.map((r) => [r.ts, Number(r.power_w)]));
const paired = co
  .map((r) => ({ ts: r.ts, a: Number(r.power_w), b: byTs.get(r.ts) }))
  .filter((r) => r.b !== undefined);

console.log(`Shared dual-channel meter — last ${HOURS}h`);
console.log(`online samples: co=${co.length} lo=${lo.length}, paired=${paired.length}\n`);

const swaps = findChannelSwaps(paired);
if (!swaps.length) {
  console.log('No channel interchange detected in this window.');
  process.exit(0);
}

console.log(`${swaps.length} channel interchange event(s):\n`);
for (const s of swaps) {
  console.log(`  ${s.ts.slice(0, 19).replace('T', ' ')}`);
  console.log(`    C.O yellow  ${s.from.a.toFixed(0)} W -> ${s.to.a.toFixed(0)} W`);
  console.log(`    L.O yellow  ${s.from.b.toFixed(0)} W -> ${s.to.b.toFixed(0)} W`);
  console.log(`    combined    ${(s.from.a + s.from.b).toFixed(0)} W -> ${(s.to.a + s.to.b).toFixed(0)} W  (unchanged — totals are safe)`);
}
console.log('\nThe two channels traded readings. No software stage can do this: the parsers key');
console.log('on DPS number and write to distinct context keys, and the totals engine reads those');
console.log('keys by name. The physical meter remapped its channels.');
console.log('\nAffected: per-circuit power, and per-meter ENERGY from the swap onward, since the');
console.log('accumulators keep adding to whichever channel the device now calls which.');
console.log('Unaffected: building and phase totals, which sum both channels.');
console.log('\nThis is a device fault. Re-pair or re-flash the meter; correcting it here would');
console.log('mean guessing which assignment is true, silently, inside measurements.');
