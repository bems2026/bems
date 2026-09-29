#!/usr/bin/env node
/**
 * Copy what the cloud already holds into the Pi's archive — RM-148, Stage 2. Run on the edge,
 * after the archiving ingest (RM-148a) has run for a day and BEFORE the 14-day window (Stage 4)
 * prunes anything.
 *
 *     npm run archive:backfill                       # dry run: what would be copied, and what it costs
 *     npm run archive:backfill -- --apply            # copy it
 *     npm run archive:backfill -- --import=DIR --apply
 *                                                    # import an NDJSON export (readings.ndjson,
 *                                                    # building_totals.ndjson, anomalies.ndjson)
 *
 * Options: --streams=readings,building_totals,anomalies  --since=ISO  --until=ISO
 *
 * READS ONLY from the cloud (GET, service role). Writes only to the archive, as `cloud` rows (or
 * `import` rows from a file), which the uploader never sends back. Safe to run twice: a row the
 * archive already holds is skipped. Safe beside the running ingest daemon: SQLite lets one writer
 * in at a time and each window is a short transaction.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from '../node-red-bridge/nodeRedAdmin.mjs';
import { makeSupabaseClient } from './supabaseRest.mjs';
import { openArchive, STREAMS } from './archiveDb.mjs';
import { backfillStream, windowQuery, windowsBetween, importNdjson, WINDOW_MS, PAGE_LIMIT } from './archiveBackfill.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
loadDotEnv(ROOT);
loadDotEnv(HERE);

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const APPLY = process.argv.includes('--apply');
const STREAM_NAMES = arg('streams', Object.keys(STREAMS).join(',')).split(',').filter(Boolean);
const IMPORT_DIR = arg('import', null);
const ARCHIVE_PATH = process.env.ARCHIVE_DB_PATH || path.join(HERE, 'data', 'archive', 'archive.sqlite');
/**
 * Asked one device at a time only where one device fills a window: a reading a minute is 720 a
 * device in 12 hours. Anomalies run to a few hundred a day for the whole fleet, so asking per
 * device would be 20 requests where one does.
 */
const PER_DEVICE = new Set(['readings']);
/** Rough bytes per row on the wire, for the egress estimate only. */
const WIRE_BYTES = { readings: 450, building_totals: 330, anomalies: 300 };

for (const s of STREAM_NAMES) {
  if (!(s in STREAMS)) {
    console.error(`unknown stream ${s} — expected ${Object.keys(STREAMS).join(', ')}`);
    process.exit(2);
  }
}

if (IMPORT_DIR) {
  runImport();
} else {
  await runBackfill();
}

function runImport() {
  const plan = STREAM_NAMES.map((s) => ({ stream: s, file: path.resolve(IMPORT_DIR, `${s}.ndjson`) })).filter((p) => fs.existsSync(p.file));
  if (plan.length === 0) {
    console.error(`no ${STREAM_NAMES.map((s) => `${s}.ndjson`).join(' / ')} in ${IMPORT_DIR}`);
    process.exit(2);
  }
  for (const { stream, file } of plan) {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
    console.log(`${stream}: ${lines.length} row(s) in ${file}`);
  }
  if (!APPLY) {
    console.log('\nDry run. Nothing written. Add --apply to import them as `import` rows (kept, never uploaded).');
    return;
  }
  const archive = openArchive(ARCHIVE_PATH);
  try {
    for (const { stream, file } of plan) {
      const r = importNdjson({ archive, stream, lines: fs.readFileSync(file, 'utf8').split('\n') });
      console.log(`${stream}: read ${r.read}, newly archived ${r.inserted}`);
    }
    printStats(archive);
  } finally {
    archive.close();
  }
}

async function runBackfill() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in server/.env');
    process.exit(2);
  }
  const supabase = makeSupabaseClient({ url, serviceRoleKey: key, timeoutMs: 30_000 });
  const count = async (stream) => {
    const res = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/${stream}?select=ts&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact', Range: '0-0' },
    });
    if (!res.ok) throw new Error(`count ${stream} -> ${res.status}`);
    return Number(res.headers.get('content-range')?.split('/')[1] ?? NaN);
  };
  const edge = async (stream, dir) => (await supabase.select(stream, `select=ts&order=ts.${dir}&limit=1`))[0]?.ts ?? null;

  const deviceIds = (await supabase.select('devices', 'select=id&order=id.asc&limit=1000')).map((d) => d.id);
  const untilMs = arg('until', null) ? Date.parse(arg('until')) : Math.ceil((Date.now() + 1) / 60_000) * 60_000;

  const plans = [];
  for (const stream of STREAM_NAMES) {
    const oldest = await edge(stream, 'asc');
    if (!oldest) {
      console.log(`${stream}: the cloud holds nothing`);
      continue;
    }
    const sinceMs = arg('since', null) ? Date.parse(arg('since')) : Math.floor(Date.parse(oldest) / 3_600_000) * 3_600_000;
    const rows = await count(stream);
    const scopes = PER_DEVICE.has(stream) ? deviceIds.length : 1;
    const windows = windowsBetween(sinceMs, untilMs, WINDOW_MS).length * scopes;
    plans.push({ stream, sinceMs, rows, windows });
    console.log(`${stream}: ${rows.toLocaleString()} row(s) in the cloud from ${new Date(sinceMs).toISOString()}, ` +
      `${windows} request(s), about ${(rows * WIRE_BYTES[stream] / 1e6).toFixed(0)} MB of egress`);
  }
  const egress = plans.reduce((a, p) => a + p.rows * WIRE_BYTES[p.stream], 0);
  console.log(`\nTotal egress about ${(egress / 1e9).toFixed(2)} GB, against the plan's 5 GB a month.`);

  let archive;
  if (!APPLY) {
    try {
      archive = openArchive(ARCHIVE_PATH, { readOnly: true });
      printStats(archive);
    } catch (err) {
      console.log(`The archive is not there yet (${err.message.split(' — ')[0]}). Deploy RM-148a and let ingest create it first.`);
    } finally {
      archive?.close();
    }
    console.log('\nDry run. Nothing copied. Add --apply to copy the rows above into the archive as `cloud` rows.');
    return;
  }

  archive = openArchive(ARCHIVE_PATH);
  try {
    for (const { stream, sinceMs } of plans) {
      let current = null;
      let deviceTotal = 0;
      const flush = () => {
        if (current !== null) console.log(`  ${stream} ${current ?? ''}: ${deviceTotal} newly archived`);
      };
      const result = await backfillStream({
        archive,
        stream,
        deviceIds: PER_DEVICE.has(stream) ? deviceIds : undefined,
        sinceMs,
        untilMs,
        fetchWindow: (s, w) => supabase.select(s, windowQuery(s, { ...w, limit: PAGE_LIMIT })),
        onWindow: ({ deviceId, inserted }) => {
          const label = deviceId ?? 'all';
          if (label !== current) {
            flush();
            current = label;
            deviceTotal = 0;
          }
          deviceTotal += inserted;
        },
      });
      flush();
      console.log(`${stream}: fetched ${result.fetched}, newly archived ${result.inserted}, in ${result.windows} window(s) — every window checked`);
    }
    printStats(archive);
  } finally {
    archive.close();
  }
}

function printStats(archive) {
  const s = archive.stats();
  console.log(`\nArchive ${archive.file}: ${s.readings.toLocaleString()} readings, ${s.building_totals.toLocaleString()} totals, ` +
    `${s.anomalies.toLocaleString()} anomalies, ${s.capability_sets.toLocaleString()} capability sets; ` +
    `${s.oldest ?? '—'} to ${s.newest ?? '—'}; ${(s.bytes / 1e6).toFixed(1)} MB`);
}
