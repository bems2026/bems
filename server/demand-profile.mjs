#!/usr/bin/env node
/**
 * Reads the recorded building totals and reports the demand profile, so a DSM threshold can be
 * chosen from evidence rather than guessed.
 *
 *     node server/demand-profile.mjs [--hours=N]
 *
 * READ-ONLY. Writes nothing, and configures nothing — it prints numbers for a human to decide
 * with, because deciding where to cut power to a working building is a human's call.
 *
 * PAGINATION IS LOAD-BEARING. PostgREST caps every result at db-max-rows (1000 here) and says
 * nothing when it truncates. A first pass at this analysis asked for 4000 rows, got exactly
 * 1000, and computed percentiles over 53% of the data without any sign that it had — the same
 * trap `phase9_history_buckets.sql` and `server/backup.mjs` were both written to escape. The
 * loop below stops only when a short page proves the end was reached, and the row count is
 * printed so a silent cap would be visible.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDotEnv } from '../node-red-bridge/nodeRedAdmin.mjs';
import { summarize, suggestThreshold } from './demandProfile.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
loadDotEnv(join(HERE, '..'));
loadDotEnv(HERE);

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const HOURS = Number(arg('hours', '0'));
const PAGE = 1000;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in server/.env');
  process.exit(2);
}

let filter = 'total_power_w=not.is.null';
if (HOURS > 0) filter += `&ts=gte.${new Date(Date.now() - HOURS * 3600_000).toISOString()}`;

const rows = [];
for (let page = 0; ; page++) {
  const from = page * PAGE;
  const res = await fetch(
    `${url}/rest/v1/building_totals?select=ts,total_power_w,phase_current_red,phase_current_yellow&${filter}&order=ts.asc`,
    { headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + PAGE - 1}` } },
  );
  if (!res.ok && res.status !== 206) {
    console.error(`Fetch failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const batch = await res.json();
  rows.push(...batch);
  // A short page is the only proof the end was reached. A full one is what a cap looks like.
  if (batch.length < PAGE) break;
  if (page > 200) {
    console.error('Refusing to page further — something is wrong with the range loop.');
    process.exit(1);
  }
}

if (!rows.length) {
  console.log('No non-null building totals recorded. Totals read null whenever the meters are');
  console.log('offline (by design — see shared/buildLatest.mjs), so this needs the meters up.');
  process.exit(0);
}

const power = summarize(rows.map((r) => r.total_power_w));
const red = summarize(rows.map((r) => r.phase_current_red));
const yellow = summarize(rows.map((r) => r.phase_current_yellow));
const phase = summarize([...rows.map((r) => r.phase_current_red), ...rows.map((r) => r.phase_current_yellow)]);

const f = (v, u, d = 2) => (v == null ? '—' : v.toFixed(d) + u);
const line = (label, s, u) =>
  console.log(
    `${label.padEnd(14)} n=${String(s?.n ?? 0).padStart(5)}  p50 ${f(s?.p50, u)}  p95 ${f(s?.p95, u)}  p99 ${f(s?.p99, u)}  max ${f(s?.max, u)}`,
  );

console.log(`Building demand — ${rows.length} readings with real totals`);
console.log(`window: ${rows[0].ts.slice(0, 16)} -> ${rows[rows.length - 1].ts.slice(0, 16)}${HOURS ? ` (last ${HOURS}h)` : ''}\n`);
line('total power', power, ' W');
line('phase red', red, ' A');
line('phase yellow', yellow, ' A');

const kw = suggestThreshold(power && { ...power, max: power.max / 1000, p99: power.p99 / 1000 });
const amps = suggestThreshold(phase);

console.log('\nSuggested DSM limits — a ceiling the building should not cross, NOT a description');
console.log('of what it usually draws. Anchoring at a percentile would shed load on a busy day.\n');
console.log(`  max_total_kw       ${kw.value ?? '(none)'}   ${kw.reason}`);
console.log(`  max_phase_current  ${amps.value ?? '(none)'}   ${amps.reason}`);
console.log('\nThese are suggestions. Nothing is written — set them on the Automation page.');
console.log('Note the recorded window covers an outage during which totals were null and are');
console.log('therefore absent here, so the peak reflects the hours the meters were actually up.');
