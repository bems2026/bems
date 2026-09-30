#!/usr/bin/env node
/**
 * The weekly backup into file storage, and the restore drill — RM-149. What a run does, and why in
 * that order, is `server/backupCycle.mjs`'s header.
 *
 *     npm run backup:cycle              dry run: what it would export, where to, and what it keeps
 *     npm run backup:cycle -- --apply   do it (ibems-backup.timer runs this weekly)
 *
 * Reads the database; writes to the private bucket (ARCHIVE_BUCKET, default ibems-archive) under
 * <site>/backup/<UTC day>/ and to BACKUP_LOCAL_DIR (default ~/backups/ibems-weekly), keeping
 * BACKUP_KEEP_WEEKS (default 8) and 4 on the edge. A failure is sent to the phone (NTFY_TOPIC) and
 * exits 1, so `systemctl status ibems-backup` shows it too.
 */

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from '../node-red-bridge/nodeRedAdmin.mjs';
import { makeStorageClient } from './supabaseStorage.mjs';
import { openArchive } from './archiveDb.mjs';
import { drillDay } from './archiveDrill.mjs';
import { BACKUP_TABLES, fetchAll, makePageFetcher } from './backup.mjs';
import { runBackupCycle, pickDrillDay, backupFolder, BACKUP_KEEP_WEEKS, BACKUP_KEEP_LOCAL } from './backupCycle.mjs';
import { createNotifier } from './notify.mjs';
import { SITE } from '../shared/registry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv(path.join(HERE, '..'));
loadDotEnv(HERE);

const APPLY = process.argv.includes('--apply');
const BUCKET = process.env.ARCHIVE_BUCKET || 'ibems-archive';
const LOCAL_DIR = process.env.BACKUP_LOCAL_DIR || path.join(os.homedir(), 'backups', 'ibems-weekly');
const keepEnv = Number(process.env.BACKUP_KEEP_WEEKS);
const KEEP_WEEKS = Number.isInteger(keepEnv) && keepEnv >= 1 ? keepEnv : BACKUP_KEEP_WEEKS;
const ARCHIVE_PATH = process.env.ARCHIVE_DB_PATH || path.join(HERE, 'data', 'archive', 'archive.sqlite');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('[ibems-backup] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required — see server/.env.example');
  process.exit(2);
}
const storage = makeStorageClient({ url, serviceRoleKey: key });
const day = new Date().toISOString().slice(0, 10);

if (!APPLY) {
  console.log(`[ibems-backup] dry run. With --apply this would:`);
  console.log(`  export ${BACKUP_TABLES.length} table(s): ${BACKUP_TABLES.map((t) => t.table).join(', ')}`);
  console.log(`  upload them to ${BUCKET}/${backupFolder(SITE.id, day)}/, manifest last, and read each back`);
  console.log(`  keep a copy in ${path.join(LOCAL_DIR, day)}`);
  console.log(`  then keep the newest ${KEEP_WEEKS} backup(s) in the bucket and ${BACKUP_KEEP_LOCAL} on this machine`);
  console.log(`  and restore one sealed day at random from ${BUCKET} as a drill`);
  const bucket = await storage.getBucket(BUCKET).catch((err) => ({ error: String(err?.message ?? err) }));
  console.log(bucket?.error ? `  (could not check the bucket: ${bucket.error})` : bucket ? `  bucket ${BUCKET} exists` : `  bucket ${BUCKET} does NOT exist: npm run archive:storage -- --apply first`);
  process.exit(0);
}

const fetchPage = makePageFetcher({ url, serviceRoleKey: key });
let live = null;
try {
  live = openArchive(ARCHIVE_PATH, { readOnly: true });
} catch (err) {
  console.warn(`[ibems-backup] no archive at ${ARCHIVE_PATH} (${String(err?.message ?? err)}) — the restore drill is skipped`);
}

const started = Date.now();
let result;
try {
  result = await runBackupCycle({
    exportTable: (table, order) => fetchAll({ fetchPage, table, order }),
    storage,
    bucket: BUCKET,
    siteId: SITE.id,
    localDir: LOCAL_DIR,
    keepWeeks: KEEP_WEEKS,
    drill: live
      ? async () => {
        const drillOn = pickDrillDay(live.seals());
        return drillOn ? { day: drillOn, ...(await drillDay({ storage, bucket: BUCKET, siteId: SITE.id, day: drillOn, liveArchive: live })) } : null;
      }
      : null,
    log: (line) => console.log(`[ibems-backup] ${line}`),
  });
} finally {
  live?.close();
}

const secs = Math.round((Date.now() - started) / 1000);
console.log(`[ibems-backup] ${result.folder}: ${result.verified} file(s) uploaded and read back, ${(result.bytes / 1e6).toFixed(2)} MB, ${secs} s`);
if (result.dropped.length) console.log(`[ibems-backup] removed older backup(s) from the bucket: ${result.dropped.join(', ')}`);
if (result.droppedLocal.length) console.log(`[ibems-backup] removed older backup(s) from ${LOCAL_DIR}: ${result.droppedLocal.join(', ')}`);
if (result.drill) {
  console.log(`[ibems-backup] restore drill of ${result.drill.day}: ${result.drill.ok ? 'passed' : 'FAILED'} (${(result.drill.streams ?? []).map((s) => `${s.stream} ${s.missing ? 'not sealed' : `${s.rows} row(s) ${s.ok ? 'ok' : 'MISMATCH'}`}`).join(', ')})`);
}
if (!result.ok) {
  console.error(`[ibems-backup] BACKUP INCOMPLETE: ${result.errors.join('; ')}`);
  await createNotifier(process.env).notify('iBEMS weekly backup failed', result.errors.join('\n'), 'high');
  process.exitCode = 1;
}
