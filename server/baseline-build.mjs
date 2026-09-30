#!/usr/bin/env node
/**
 * `npm run baseline:build` — the projected baseline, built from the recorded hours. RM-153.
 *
 *   npm run baseline:build                     fetch, build, print the tables; writes nothing
 *   npm run baseline:build -- --write          ...and write shared/sites/<site>/baseline.mjs
 *   npm run baseline:build -- --save=<file>    keep the fetched rows, so the build can be repeated
 *   npm run baseline:build -- --from=<file>    build from kept rows instead of the database
 *
 * READ-ONLY against the database: `readings_archive` (hourly buckets per building meter),
 * `report_hour_matrix` (the building's highest minute per hour) and `commands` (which days an
 * automation source acted). Run it on the edge, which holds the service-role key in `server/.env`;
 * the written module is then copied back and committed, like any other site file. There is no
 * baseline table and no runtime query: the page imports the file.
 *
 * The rules are the site's (`baseline-rules.mjs` beside `site.mjs`) and the method is
 * `server/baselineModel.mjs`'s. This file only fetches and prints.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SITE, CIRCUITS } from '../shared/siteConfig.mjs';
import { buildingMetersByLoad, LOAD_LABELS } from '../shared/circuits.mjs';
import { buildBaseline, renderBaselineModule } from './baselineModel.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const WRITE = process.argv.includes('--write');

// `site:check` holds SITE.id to the directory name, which is what lets this avoid naming one.
const siteDir = join(ROOT, 'shared', 'sites', SITE.id);
const rulesPath = join(siteDir, 'baseline-rules.mjs');
if (!existsSync(rulesPath)) {
  console.error(`No ${rulesPath}. Write the site's baseline rules first — see docs/90-replication.md, step 6.`);
  process.exit(2);
}
const { BASELINE_RULES: rules } = await import(pathToFileURL(rulesPath).href);
if (!SITE.working_hours || !SITE.working_week) {
  console.error('SITE has no working_hours / working_week — the baseline needs to know when the office works.');
  process.exit(2);
}
const meterLoads = buildingMetersByLoad(CIRCUITS);

function loadEnv() {
  try {
    return Object.fromEntries(
      readFileSync(join(HERE, '.env'), 'utf8')
        .split(/\r?\n/)
        .filter((l) => l && !l.startsWith('#') && l.includes('='))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }),
    );
  } catch {
    return {};
  }
}

/** Local midnight of a building date, as a UTC instant. */
const localMidnight = (date) => Date.parse(`${date}T00:00:00Z`) - SITE.utc_offset_minutes * 60_000;

async function fetchRows() {
  const env = { ...loadEnv(), ...process.env };
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed (server/.env). Read-only; nothing is written to the database.');
    process.exit(2);
  }
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const rpc = async (fn, body) => {
    const r = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`${fn} ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.json();
  };

  const start = localMidnight(rules.record.from);
  const end = localMidnight(rules.record.to) + 86_400_000;
  const STEP = 12 * 86_400_000; // 288 hourly rows a call, under PostgREST's 1,000-row cap
  const hourly = {};
  for (const meterId of meterLoads.flatMap((g) => g.meterIds)) {
    hourly[meterId] = [];
    for (let t = start; t < end; t += STEP) {
      const rows = await rpc('readings_archive', {
        p_device_id: meterId,
        p_since: new Date(t).toISOString(),
        p_until: new Date(Math.min(end, t + STEP)).toISOString(),
        p_bucket_seconds: 3600,
      });
      hourly[meterId].push(...rows);
    }
    console.error(`  ${meterId}: ${hourly[meterId].length} hourly rows`);
  }

  // The building's highest minute per hour, one calendar month a call (at most 744 cells, under
  // the function's own 900 cap).
  const buildingPeaks = [];
  const months = new Set();
  for (let t = Date.parse(`${rules.record.from}T00:00:00Z`); t <= Date.parse(`${rules.record.to}T00:00:00Z`); t += 86_400_000) {
    months.add(new Date(t).toISOString().slice(0, 7));
  }
  for (const month of months) {
    const cells = await rpc('report_hour_matrix', { p_period: 'month', p_start: `${month}-01`, p_tz: SITE.timezone });
    const byDay = new Map();
    for (const c of cells) {
      if (c.max_power_w === null) continue;
      byDay.set(c.local_day, Math.max(byDay.get(c.local_day) ?? 0, Number(c.max_power_w)));
    }
    for (const [local_day, max_w] of byDay) buildingPeaks.push({ local_day, max_w });
    console.error(`  report_hour_matrix ${month}: ${cells.length} cells`);
  }

  const commands = [];
  const sources = rules.automation_sources.join(',');
  for (let offset = 0; ; offset += 1000) {
    const q =
      `commands?select=requested_at,source,device_id,action` +
      `&source=in.(${sources})` +
      `&requested_at=gte.${new Date(start).toISOString()}&requested_at=lt.${new Date(end).toISOString()}` +
      `&order=requested_at.asc,id.asc&offset=${offset}&limit=1000`;
    const r = await fetch(`${url}/rest/v1/${q}`, { headers });
    if (!r.ok) throw new Error(`commands ${r.status}`);
    const rows = await r.json();
    commands.push(...rows);
    if (rows.length < 1000) break;
  }
  console.error(`  commands from ${rules.automation_sources.join(', ')}: ${commands.length}`);
  return { hourly, buildingPeaks, commands };
}

const from = arg('from');
const rows = from ? JSON.parse(readFileSync(from, 'utf8')) : await fetchRows();
if (arg('save')) {
  writeFileSync(arg('save'), JSON.stringify(rows));
  console.error(`  rows kept in ${arg('save')}`);
}

const baseline = buildBaseline({
  site: SITE,
  meterLoads,
  hourly: rows.hourly,
  commands: rows.commands ?? [],
  buildingPeaks: rows.buildingPeaks ?? [],
  rules,
  generatedAt: new Date().toISOString(),
});

// --- print ----------------------------------------------------------------------------------------
const label = (l) => LOAD_LABELS[l] ?? l;
const fmt = (w) => String(Math.round(w)).padStart(5);
console.log(`\nProjected baseline for ${SITE.display_name}, ${baseline.window.from} – ${baseline.window.to} (${baseline.window.days} days)`);
for (const t of Object.values(baseline.day_types)) {
  console.log(`\n${t.label}: ${t.days.length} days (${t.days.join(', ')})`);
  console.log(`  hour     ${Array.from({ length: 24 }, (_, h) => String(h).padStart(5)).join('')}`);
  for (const l of baseline.loads) console.log(`  ${label(l).padEnd(8)} ${t.profile_w[l].map(fmt).join('')}  ${t.kwh[l].toFixed(2)} kWh`);
  console.log(
    `  ${t.kwh.total.toFixed(2)} kWh a day; ${Math.round(t.working_hours_share * 100)}% in working hours; ` +
      `base standby ${Math.round(t.standby_w)} W; working-hours demand ${Math.round(t.working_hours_avg_w)} W; highest hour ${Math.round(t.highest_hourly_w)} W`,
  );
}
console.log(`\nTypical week: ${baseline.week.kwh.total.toFixed(1)} kWh (${baseline.loads.map((l) => `${label(l)} ${baseline.week.kwh[l].toFixed(1)}`).join(', ')})`);
console.log(`Standard month (${baseline.standard_month.days} days): ${baseline.standard_month.kwh.total.toFixed(0)} kWh`);
console.log(
  baseline.peak_operating_draw.w === null
    ? 'Peak operating draw: no building peaks were read'
    : `Peak operating draw: ${Math.round(baseline.peak_operating_draw.w)} W (90th percentile of ${baseline.peak_operating_draw.days} working days' highest minute)`,
);
console.log('\nNot used:');
for (const e of baseline.excluded) console.log(`  ${e.date}  ${e.reason}`);
for (const d of baseline.dropped_hours) console.log(`  ${d.date}  hours ${d.hours.join(', ')} dropped: ${d.reason}`);
console.log('\nCoverage of the window:');
for (const [m, c] of Object.entries(baseline.coverage)) console.log(`  ${m.padEnd(16)} ${(c * 100).toFixed(1)}%`);
for (const w of baseline.warnings) console.log(`\nWARNING: ${w}`);

if (WRITE) {
  const out = join(siteDir, 'baseline.mjs');
  writeFileSync(out, renderBaselineModule(baseline));
  console.log(`\nwritten ${out}`);
} else {
  console.log('\nDry run: nothing written. Add --write to replace the site\'s baseline.mjs.');
}
