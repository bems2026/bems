#!/usr/bin/env node
/**
 * RM-148's one-time hot-tier reset — giving the cloud back the space its raw tables hold. Run on the edge.
 *
 * Pruning deletes rows but never shrinks a table's files, and `VACUUM FULL` builds a whole new copy
 * beside the old one, which at this size could tip the Free plan's database into read-only mode
 * mid-way. So instead, in this order:
 *
 *   1. touch server/data/ingest.pause          ingest keeps archiving; it stops uploads, retention, reports
 *   2. npm run archive:reset                   (this, read-only) — is it safe to empty the raw tables?
 *   3. in the SQL editor: truncate readings, building_totals;
 *   4. npm run archive:reset -- --reload --apply   the hot window goes back up from the archive
 *   5. rm server/data/ingest.pause             ingest resumes and uploads what it archived meanwhile
 *
 * Step 2 says "ready" only when all of these hold:
 *   - the pause file exists;
 *   - nothing older than the hot window is left in the cloud (the janitor has rolled it all up, so
 *     the TRUNCATE loses no hour the rollups do not already hold);
 *   - for every device and hour of the hot window, the archive holds at least what the cloud does.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from '../node-red-bridge/nodeRedAdmin.mjs';
import { makeSupabaseClient } from './supabaseRest.mjs';
import { openArchive } from './archiveDb.mjs';
import { coverageShortfall } from './archiveJanitor.mjs';
import { reloadWindow } from './archiveReload.mjs';
import { RAW_RETENTION_DAYS } from '../shared/retention.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv(path.join(HERE, '..'));
loadDotEnv(HERE);

const RELOAD = process.argv.includes('--reload');
const APPLY = process.argv.includes('--apply');
const ARCHIVE_PATH = process.env.ARCHIVE_DB_PATH || path.join(HERE, 'data', 'archive', 'archive.sqlite');
const PAUSE_PATH = process.env.INGEST_PAUSE_PATH || path.join(HERE, 'data', 'ingest.pause');
const HOT_DAYS = Number(process.env.INGEST_RETENTION_DAYS) || RAW_RETENTION_DAYS;
const DAY = 86_400_000;
const HOUR = 3_600_000;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in server/.env');
  process.exit(2);
}
const supabase = makeSupabaseClient({ url, serviceRoleKey: key, timeoutMs: 60_000 });
const count = async (table, sinceMs) => {
  const res = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/${table}?select=ts&ts=gte.${encodeURIComponent(new Date(sinceMs).toISOString())}&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact', Range: '0-0' },
  });
  return Number(res.headers.get('content-range')?.split('/')[1] ?? NaN);
};

const now = Date.now();
const cutoff = Math.floor((now - HOT_DAYS * DAY) / HOUR) * HOUR;
const pausedNow = fs.existsSync(PAUSE_PATH);
const archive = openArchive(ARCHIVE_PATH, { readOnly: !(RELOAD && APPLY) });

try {
  if (!RELOAD) await check();
  else await reload();
} finally {
  archive.close();
}

async function check() {
  let ready = true;
  const say = (ok, line) => { console.log(`${ok ? 'ok ' : 'NO '} ${line}`); if (!ok) ready = false; };

  say(pausedNow, `ingest paused (${PAUSE_PATH})`);
  for (const table of ['readings', 'building_totals']) {
    const oldest = (await supabase.select(table, 'select=ts&order=ts.asc&limit=1'))[0]?.ts ?? null;
    say(!oldest || Date.parse(oldest) >= cutoff,
      `${table}: oldest cloud row ${oldest ?? '—'} is inside the ${HOT_DAYS}-day window (from ${new Date(cutoff).toISOString()}), so every older hour is already rolled up`);
    let missing = 0;
    for (let s = cutoff; s < now; s += DAY) {
      const short = await coverageShortfall({ client: supabase, archive, stream: table, since: s, until: Math.min(s + DAY, now + HOUR) });
      missing += short.reduce((a, x) => a + (x.cloud - x.held), 0);
    }
    say(missing === 0, `${table}: the archive holds every row the cloud has in the window${missing ? ` — ${missing} missing` : ''}`);
  }
  if (ready) {
    console.log('\nReady. In the SQL editor, run exactly:\n\n    truncate readings, building_totals;\n\nthen: npm run archive:reset -- --reload --apply');
  } else {
    console.log('\nNot ready. Nothing to do yet; fix the lines marked NO first.');
    process.exitCode = 1;
  }
}

async function reload() {
  if (!pausedNow) {
    console.error(`Refusing: ingest is not paused (${PAUSE_PATH} does not exist). Pause it, check, truncate, then reload.`);
    process.exit(2);
  }
  for (const stream of ['readings', 'building_totals']) {
    const inArchive = archive.countRange(stream, { sinceMs: cutoff, untilMs: now + HOUR });
    console.log(`${stream}: ${inArchive.toLocaleString()} archived row(s) from ${new Date(cutoff).toISOString()}; cloud holds ${(await count(stream, cutoff)).toLocaleString()} now`);
    if (!APPLY) continue;
    const r = await reloadWindow({ archive, send: (s, rows, c) => supabase.upsert(s, rows, { onConflict: c }), stream, sinceMs: cutoff, untilMs: now + HOUR });
    console.log(`${stream}: sent ${r.sent.toLocaleString()} in ${r.batches} batch(es); cloud now holds ${(await count(stream, cutoff)).toLocaleString()}`);
  }
  if (!APPLY) console.log('\nDry run. Add --apply to send them.');
  else console.log(`\nDone. Remove ${PAUSE_PATH} and ingest resumes, uploading what it archived meanwhile.`);
}
