#!/usr/bin/env node
/**
 * Writes the baseline energy dataset and benchmarking summary — Milestone 1's artifact.
 *
 *     node server/baseline-report.mjs [--days=N] [--out=DIR]
 *
 * READ-ONLY against the database. It writes two files and changes nothing else:
 *
 *     reports/baseline-<site>-<date>.md    the summary, for a person
 *     reports/baseline-<site>-<date>.csv   the dataset it was computed from, for checking
 *
 * BOTH HALVES, ALWAYS. Milestone 1 asks for "a baseline energy dataset and benchmarking
 * summary" — two things. A summary whose underlying readings cannot be re-read is an assertion,
 * and a dataset nobody has summarised is not a deliverable. Writing them together also means the
 * pair can never drift: the CSV is the exact input to the Markdown beside it.
 *
 * PAGINATION IS LOAD-BEARING, for the same reason it is in `demand-profile.mjs`: PostgREST caps
 * every result at db-max-rows and says nothing when it truncates. A baseline silently computed
 * over the first 1000 rows of a two-month window would be wrong in the direction nobody checks.
 *
 * The output directory is gitignored. These are dated artifacts that go to the university; a
 * repository accumulating stale copies of them is how the wrong quarter gets cited.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { loadDotEnv } from '../node-red-bridge/nodeRedAdmin.mjs';
import { SITE } from '../shared/siteConfig.mjs';
import { renderDataset, renderReport, siteParts } from './baselineReport.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
loadDotEnv(ROOT);
loadDotEnv(HERE);

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const DAYS = Number(arg('days', '0'));
const OUT_DIR = resolve(ROOT, arg('out', 'reports'));
const PAGE = 1000;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in server/.env');
  console.error('This reads recorded history, so it needs the database — it cannot be run offline.');
  process.exit(2);
}

let filter = 'total_power_w=not.is.null';
if (DAYS > 0) filter += `&ts=gte.${new Date(Date.now() - DAYS * 86400_000).toISOString()}`;

const rows = [];
for (let page = 0; ; page++) {
  const from = page * PAGE;
  const res = await fetch(
    `${url}/rest/v1/building_totals?select=ts,total_power_w,energy_kwh_today&${filter}&order=ts.asc`,
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
  if (page > 500) {
    console.error('Refusing to page further — something is wrong with the range loop.');
    process.exit(1);
  }
}

const offset = SITE.utc_offset_minutes;
const today = siteParts(Date.now(), offset).date;
const windowLabel = DAYS > 0 ? `the last ${DAYS} day(s)` : 'all recorded data';

const md = renderReport({
  rows,
  offsetMinutes: offset,
  siteName: SITE.display_name,
  timezone: SITE.timezone,
  generatedMs: Date.now(),
  windowLabel,
});
const csv = renderDataset(rows, offset);

mkdirSync(OUT_DIR, { recursive: true });
const base = join(OUT_DIR, `baseline-${SITE.id}-${today}`);
const mdPath = `${base}.md`;
const csvPath = `${base}.csv`;
const replaced = existsSync(mdPath) || existsSync(csvPath);

writeFileSync(mdPath, md, 'utf8');
writeFileSync(csvPath, csv, 'utf8');

console.log(`${rows.length} readings with a real total`);
if (!rows.length) {
  console.log('Totals read null whenever the meters are offline (by design), so an empty result');
  console.log('is a measurement problem rather than a building that used nothing. The report says so.');
}
console.log(`wrote ${mdPath}`);
console.log(`wrote ${csvPath}`);
if (replaced) console.log('(a report for this site and date already existed and was replaced)');
