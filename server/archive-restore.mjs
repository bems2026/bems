#!/usr/bin/env node
/**
 * Restore sealed days from the off-edge copy — RM-148, Stage 4. A backup that has never been
 * restored is a hope, so this is also the restore drill.
 *
 *     npm run archive:restore -- --day=2026-09-01
 *         The drill: download that day's sealed files, load them into a throwaway archive, seal it
 *         again, and check the result is byte-for-byte the day that was sealed (same sha256).
 *         Writes nothing outside a temporary directory.
 *
 *     npm run archive:restore -- --since=2026-08-16 --until=2026-09-29 --into=PATH [--apply]
 *         Recovery after losing the card: every sealed day in the range into the archive at PATH
 *         (a new file, or one being rebuilt). Days the bucket does not hold are listed, not guessed.
 *         Afterwards `npm run archive:backfill -- --apply` fills the recent days the cloud still holds.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from '../node-red-bridge/nodeRedAdmin.mjs';
import { makeStorageClient } from './supabaseStorage.mjs';
import { openArchive, STREAMS } from './archiveDb.mjs';
import { rowsFromCsv, sealDay, storagePathFor, dayStartMs, utcDay } from './archiveSeal.mjs';
import { SITE } from '../shared/registry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv(path.join(HERE, '..'));
loadDotEnv(HERE);

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const APPLY = process.argv.includes('--apply');
const BUCKET = process.env.ARCHIVE_BUCKET || 'ibems-archive';
const LIVE_ARCHIVE = process.env.ARCHIVE_DB_PATH || path.join(HERE, 'data', 'archive', 'archive.sqlite');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in server/.env');
  process.exit(2);
}
const storage = makeStorageClient({ url, serviceRoleKey: key });

/** One day's streams into `archive`; returns what was found and what it hashed to. */
async function restoreDay(archive, day) {
  const out = [];
  for (const stream of Object.keys(STREAMS)) {
    const where = storagePathFor({ siteId: SITE.id, day, stream });
    let bytes;
    try {
      bytes = await storage.download(BUCKET, where);
    } catch (err) {
      if (err.status === 400 || err.status === 404) { out.push({ stream, missing: true }); continue; }
      throw err;
    }
    const csv = zlib.gunzipSync(bytes).toString('utf8');
    const rows = rowsFromCsv(stream, csv);
    for (const origin of new Set(rows.map((r) => r.origin))) {
      archive.insertRows(stream, rows.filter((r) => r.origin === origin).map(({ origin: _o, ...r }) => r), { origin });
    }
    out.push({ stream, rows: rows.length, sha256: crypto.createHash('sha256').update(csv).digest('hex') });
  }
  return out;
}

const day = arg('day', null);
if (day) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibems-restore-drill-'));
  const scratch = openArchive(path.join(dir, 'archive.sqlite'));
  let live = null;
  try { live = openArchive(LIVE_ARCHIVE, { readOnly: true }); } catch { /* the drill still compares the file with itself */ }
  let failed = false;
  try {
    for (const r of await restoreDay(scratch, day)) {
      if (r.missing) { console.log(`${day} ${r.stream}: not in the bucket`); continue; }
      const resealed = sealDay({ archive: scratch, stream: r.stream, day }).sha256;
      const recorded = live?.sealOf(day, r.stream)?.sha256 ?? null;
      const ok = resealed === r.sha256 && (recorded === null || recorded === r.sha256);
      failed ||= !ok;
      console.log(`${ok ? 'ok ' : 'NO '} ${day} ${r.stream}: ${r.rows} row(s) restored; downloaded ${r.sha256.slice(0, 12)}, ` +
        `re-sealed ${resealed.slice(0, 12)}, recorded ${recorded ? recorded.slice(0, 12) : '— (no live archive here)'}`);
    }
  } finally {
    scratch.close();
    live?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(failed ? '\nRESTORE DRILL FAILED' : '\nRestore drill passed: the day came back exactly as it was sealed.');
  process.exitCode = failed ? 1 : 0;
} else {
  const since = arg('since', null);
  const until = arg('until', utcDay(Date.now()));
  const into = arg('into', null);
  if (!since || !into) {
    console.error('Give --day=YYYY-MM-DD for the drill, or --since=YYYY-MM-DD [--until=YYYY-MM-DD] --into=PATH for a recovery.');
    process.exit(2);
  }
  if (path.resolve(into) === path.resolve(LIVE_ARCHIVE) && fs.existsSync(LIVE_ARCHIVE)) {
    console.error('Refusing to restore into the live archive while it exists. Restore into a new file, then swap it in with ingest stopped.');
    process.exit(2);
  }
  const days = [];
  for (let s = dayStartMs(since); s <= dayStartMs(until); s += 86_400_000) days.push(utcDay(s));
  console.log(`${days.length} day(s), ${since} to ${until}, into ${into}`);
  if (!APPLY) {
    console.log('Dry run. Add --apply to download and restore them.');
  } else {
    const target = openArchive(into);
    try {
      for (const d of days) {
        const found = await restoreDay(target, d);
        console.log(`${d}: ${found.map((r) => (r.missing ? `${r.stream} missing` : `${r.stream} ${r.rows}`)).join(', ')}`);
      }
    } finally {
      target.close();
    }
  }
}
